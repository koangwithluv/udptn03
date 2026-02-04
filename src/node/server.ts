import * as net from 'net';
import { Storage } from './storage';
import { Replication } from './replication';
import { Membership } from './membership';
import logger from '../utils/logger';
import {
    Message,
    RequestMessage,
    ResponseMessage,
    ReplicationMessage,
    HeartbeatMessage,
    SnapshotRequestMessage,
    SnapshotChunkMessage,
} from '../protocol/messages';

type ServerOptions = {
    port: number;
    id: string;
    peers: number[];
};

export class Server {
    private server?: net.Server;
    private readonly storage: Storage;
    private readonly replication: Replication;
    private readonly membership: Membership;
    private readonly port: number;
    private readonly id: string;
    private readonly peers: number[];
    private readonly allNodes: number[];
    private readonly heartbeatIntervalMs = 2000;
    private readonly heartbeatTimeoutMs = 5000;
    private heartbeatTimer?: NodeJS.Timeout;
    private readonly lastSeen: Map<number, number> = new Map();

    constructor(opts: ServerOptions) {
        this.port = opts.port;
        this.id = opts.id;
        this.peers = Array.from(new Set(opts.peers.filter((p) => p !== opts.port))).sort();
        this.allNodes = Array.from(new Set([this.port, ...this.peers])).sort((a, b) => a - b);
        this.storage = new Storage();
        this.replication = new Replication(this.storage);
        this.membership = new Membership();
    }

    public async start(): Promise<void> {
        if (this.server) return;
        this.server = net.createServer(this.handleConnection.bind(this));
        await new Promise<void>((resolve) => {
            this.server!.listen(this.port, () => {
                logger.log(`Server ${this.id} listening on port ${this.port}`);
                resolve();
            });
        });
        this.startHeartbeat();
    }

    public async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (!this.server) return;
        const closing = new Promise<void>((resolve, reject) => {
            this.server!.close((err) => (err ? reject(err) : resolve()));
        });
        this.server = undefined;
        await closing;
    }

    private handleConnection(socket: net.Socket) {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (!raw.trim()) continue;
                try {
                    const msg = JSON.parse(raw) as Message;
                    this.processMessage(msg, socket).catch((err) => logger.log(`Process error: ${err}`));
                } catch (e) {
                    logger.log(`Invalid message: ${raw}`);
                }
            }
        });
    }

    private async processMessage(message: Message, socket: net.Socket) {
        switch (message.type) {
            case 'PUT':
            case 'GET':
            case 'DELETE':
                await this.handleClientRequest(message as RequestMessage, socket);
                break;
            case 'REPL_PUT':
            case 'REPL_DEL':
                await this.handleReplication(message as ReplicationMessage, socket);
                break;
            case 'HEARTBEAT':
                this.handleHeartbeat(message as HeartbeatMessage);
                break;
            case 'SNAPSHOT_REQUEST':
                await this.handleSnapshotRequest(message as SnapshotRequestMessage, socket);
                break;
            default:
                socket.write(JSON.stringify({ type: 'RESPONSE', success: false, error: 'Unknown message type' }) + '\n');
        }
    }

    private async handleClientRequest(msg: RequestMessage, socket: net.Socket) {
        const { primary, secondary } = this.pickReplicas(msg.key);

        // Forward if this node is not primary
        if (primary !== this.port) {
            const res = await this.sendToPeer(primary, msg);
            socket.write(JSON.stringify(res) + '\n');
            return;
        }

        switch (msg.type) {
            case 'PUT': {
                this.storage.put(msg.key, msg.value ?? '');
                const ok = await this.replicateToSecondary(secondary, msg.key, msg.value ?? '');
                const resp: ResponseMessage = { type: 'RESPONSE', success: ok };
                socket.write(JSON.stringify(resp) + '\n');
                break;
            }
            case 'DELETE': {
                this.storage.delete(msg.key);
                const ok = await this.replicateDeleteToSecondary(secondary, msg.key);
                const resp: ResponseMessage = { type: 'RESPONSE', success: ok };
                socket.write(JSON.stringify(resp) + '\n');
                break;
            }
            case 'GET': {
                const value = this.storage.get(msg.key);
                const resp: ResponseMessage = { type: 'RESPONSE', success: true, data: value };
                socket.write(JSON.stringify(resp) + '\n');
                break;
            }
        }
    }

    private async handleReplication(msg: ReplicationMessage, socket: net.Socket) {
        if (msg.type === 'REPL_PUT' && msg.value !== undefined) {
            this.storage.put(msg.key, msg.value);
            socket.write(JSON.stringify({ type: 'RESPONSE', success: true }) + '\n');
            return;
        }
        if (msg.type === 'REPL_DEL') {
            this.storage.delete(msg.key);
            socket.write(JSON.stringify({ type: 'RESPONSE', success: true }) + '\n');
            return;
        }
        socket.write(JSON.stringify({ type: 'RESPONSE', success: false, error: 'Bad replication msg' }) + '\n');
    }

    private handleHeartbeat(msg: HeartbeatMessage) {
        const now = Date.now();
        const port = Number(msg.nodeId);
        if (!Number.isNaN(port)) this.lastSeen.set(port, now);
    }

    private async handleSnapshotRequest(msg: SnapshotRequestMessage, socket: net.Socket) {
        const dataObj: Record<string, string> = {};
        for (const [k, v] of this.storage.entries()) {
            dataObj[k] = v;
        }
        const chunk: SnapshotChunkMessage = { type: 'SNAPSHOT_CHUNK', data: dataObj };
        socket.write(JSON.stringify(chunk) + '\n');
        socket.write(JSON.stringify({ type: 'RESPONSE', success: true }) + '\n');
    }

    private pickReplicas(key: string): { primary: number; secondary: number } {
        const nodes = this.allNodes;
        const h = this.simpleHash(key);
        const idx = h % nodes.length;
        const primary = nodes[idx];
        const secondary = nodes[(idx + 1) % nodes.length];
        return { primary, secondary };
    }

    private simpleHash(key: string): number {
        let h = 0;
        for (let i = 0; i < key.length; i++) {
            h = (h * 31 + key.charCodeAt(i)) >>> 0;
        }
        return h;
    }

    private async replicateToSecondary(port: number, key: string, value: string): Promise<boolean> {
        if (port === this.port) return true;
        const msg: ReplicationMessage = { type: 'REPL_PUT', key, value };
        const res = await this.sendToPeer(port, msg);
        return res.success === true;
    }

    private async replicateDeleteToSecondary(port: number, key: string): Promise<boolean> {
        if (port === this.port) return true;
        const msg: ReplicationMessage = { type: 'REPL_DEL', key };
        const res = await this.sendToPeer(port, msg);
        return res.success === true;
    }

    private async sendToPeer(port: number, msg: Message): Promise<ResponseMessage> {
        return new Promise<ResponseMessage>((resolve) => {
            const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
                client.write(JSON.stringify(msg) + '\n');
            });

            let buffer = '';
            client.on('data', (chunk) => {
                buffer += chunk.toString();
                const idx = buffer.indexOf('\n');
                if (idx >= 0) {
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    try {
                        const parsed = JSON.parse(raw) as ResponseMessage;
                        client.end();
                        resolve(parsed);
                    } catch (e) {
                        resolve({ type: 'RESPONSE', success: false, error: 'Bad response' });
                    }
                }
            });

            client.on('error', (err) => {
                resolve({ type: 'RESPONSE', success: false, error: err.message });
            });
        });
    }

    private startHeartbeat() {
        this.peers.forEach((p) => this.lastSeen.set(p, Date.now()));
        this.heartbeatTimer = setInterval(() => {
            const hb: HeartbeatMessage = { type: 'HEARTBEAT', nodeId: String(this.port) };
            this.peers.forEach((p) => {
                this.sendToPeer(p, hb).catch(() => undefined);
            });

            const now = Date.now();
            this.peers.forEach((p) => {
                const last = this.lastSeen.get(p) ?? 0;
                if (now - last > this.heartbeatTimeoutMs) {
                    logger.log(`Peer ${p} considered down (no heartbeat)`);
                }
            });
        }, this.heartbeatIntervalMs);
    }
}

// Factory helper used by bootstrap code
export const createServer = (port = 3000, id = 'node', peers: number[] = []): Server => new Server({ port, id, peers });