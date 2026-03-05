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
    SnapshotDoneMessage,
    MembershipMessage,
    RebalancePushMessage,
} from '../protocol/messages';
import crypto from 'crypto';

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
    private readonly heartbeatIntervalMs = 2000;
    private readonly heartbeatTimeoutMs = 5000;
    private heartbeatTimer?: NodeJS.Timeout;
    private readonly lastSeen: Map<number, number> = new Map();
    private readonly peerFailures: Map<number, number> = new Map();
    private readonly breakerOpenUntil: Map<number, number> = new Map();
    private readonly breakerBaseMs = 2000;
    private readonly sockets: Set<net.Socket> = new Set();
    private readonly seenOps: Map<string, number> = new Map();
    private readonly opTtlMs = 5 * 60 * 1000;

    constructor(opts: ServerOptions) {
        this.port = opts.port;
        this.id = opts.id;
        this.peers = Array.from(new Set(opts.peers.filter((p) => p !== opts.port))).sort();
        const snapshotPath = process.env.KV_SNAPSHOT_PATH || `data-${this.port}.json`;
        const walPath = process.env.KV_WAL_PATH || `data-${this.port}.wal`;
        this.storage = new Storage(snapshotPath, walPath);
        this.replication = new Replication(this.storage, this.port);
        this.membership = new Membership(this.peers);
        this.membership.onChange((ports, epoch) => {
            // Update local peers list for hashing
            this.peers.splice(0, this.peers.length, ...ports.filter((p) => p !== this.port));
            this.rebalanceData();
            this.broadcastMembership(epoch, ports);
        });
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
        this.broadcastJoin();
        await this.recoverFromPeers();
    }

    public async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (!this.server) return;
        // Close all active sockets to avoid dangling handles in tests
        this.sockets.forEach((s) => {
            s.destroy();
        });
        this.sockets.clear();
        const closing = new Promise<void>((resolve, reject) => {
            this.server!.close((err) => (err ? reject(err) : resolve()));
        });
        this.broadcastLeave();
        this.server = undefined;
        await closing;
    }

    private handleConnection(socket: net.Socket) {
        this.sockets.add(socket);
        let buffer = '';
        socket.on('error', (err) => {
            logger.warn(`Socket error from ${socket.remoteAddress ?? ''}:${socket.remotePort ?? ''} - ${err.message}`);
        });
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
        socket.on('close', () => this.sockets.delete(socket));
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
            case 'JOIN':
            case 'LEAVE':
            case 'MEMBERSHIP_SNAPSHOT':
                this.handleMembership(message as MembershipMessage);
                break;
            case 'REBALANCE_PUSH':
                await this.handleRebalancePush(message as RebalancePushMessage, socket);
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
            if (res.success) {
                socket.write(JSON.stringify(res) + '\n');
                return;
            }
            // Fallback: assume primary is down, handle locally
        }

        switch (msg.type) {
            case 'PUT': {
                this.storage.put(msg.key, msg.value ?? '');
                this.storage.persist();
                const ok = await this.replicateToSecondary(secondary, msg.key, msg.value ?? '');
                const resp: ResponseMessage = { type: 'RESPONSE', success: ok };
                socket.write(JSON.stringify(resp) + '\n');
                break;
            }
            case 'DELETE': {
                this.storage.delete(msg.key);
                this.storage.persist();
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
        if (msg.opId && this.seenOps.has(msg.opId)) {
            socket.write(JSON.stringify({ type: 'RESPONSE', success: true }) + '\n');
            return;
        }
        if (msg.opId) this.trackOp(msg.opId);

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

    private handleMembership(msg: MembershipMessage) {
        const port = Number(msg.nodeId);
        if (Number.isNaN(port)) return;
        const epoch = msg.epoch;
        const peers = msg.peers?.filter((p) => p !== this.port);
        if (msg.type === 'JOIN') {
            if (peers && epoch !== undefined) this.membership.merge(peers, epoch);
            else this.membership.addPeer(port, epoch);
        } else if (msg.type === 'LEAVE') {
            if (peers && epoch !== undefined) this.membership.merge(peers, epoch);
            else this.membership.removePeer(port, epoch);
        } else if (msg.type === 'MEMBERSHIP_SNAPSHOT' && peers && msg.epoch !== undefined) {
            this.membership.merge(peers, msg.epoch);
        }
    }

    private async handleRebalancePush(msg: RebalancePushMessage, socket: net.Socket) {
        let ok = true;
        for (const [key, value] of Object.entries(msg.entries)) {
            const { primary, secondary } = this.pickReplicas(key);
            if (primary !== this.port) continue;
            this.storage.put(key, value);
            const replicated = await this.replicateToSecondary(secondary, key, value);
            if (!replicated) ok = false;
        }
        socket.write(JSON.stringify({ type: 'RESPONSE', success: ok }) + '\n');
    }

    private async handleSnapshotRequest(msg: SnapshotRequestMessage, socket: net.Socket) {
        const entries = Array.from(this.storage.entries());
        const chunkSize = 200;
        const total = Math.ceil(entries.length / chunkSize) || 1;
        let seq = 0;
        const full: Record<string, string> = {};
        entries.forEach(([k, v]) => (full[k] = v));
        const globalChecksum = this.computeChecksum(full);
        for (let i = 0; i < entries.length; i += chunkSize) {
            const slice = entries.slice(i, i + chunkSize);
            const dataObj: Record<string, string> = {};
            slice.forEach(([k, v]) => (dataObj[k] = v));
            seq += 1;
            const checksum = this.computeChecksum(dataObj);
            const chunk: SnapshotChunkMessage = { type: 'SNAPSHOT_CHUNK', data: dataObj, seq, total, checksum };
            socket.write(JSON.stringify(chunk) + '\n');
        }
        if (entries.length === 0) {
            const chunk: SnapshotChunkMessage = { type: 'SNAPSHOT_CHUNK', data: {}, seq: 1, total: 1, checksum: this.computeChecksum({}) };
            socket.write(JSON.stringify(chunk) + '\n');
        }
        const done: SnapshotDoneMessage = { type: 'SNAPSHOT_DONE', totalChunks: total, checksum: globalChecksum, version: this.storage.getVersion() };
        socket.write(JSON.stringify(done) + '\n');
        socket.write(JSON.stringify({ type: 'RESPONSE', success: true }) + '\n');
    }

    private computeChecksum(data: Record<string, string>): string {
        const json = JSON.stringify(data);
        return crypto.createHash('sha256').update(json).digest('hex');
    }

    private isStorageEmpty(): boolean {
        const first = this.storage.entries().next();
        return !!first.done;
    }

    private async recoverFromPeers(): Promise<void> {
        for (const peer of this.peers) {
            const ok = await this.fetchSnapshotFromPeer(peer);
            if (ok) {
                logger.log(`Recovered state from peer ${peer}`);
                return;
            }
            logger.warn(`Recovery attempt from peer ${peer} failed`);
        }
    }

    private async fetchSnapshotFromPeer(peer: number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const client = net.createConnection({ port: peer, host: '127.0.0.1' }, () => {
                const req: SnapshotRequestMessage = { type: 'SNAPSHOT_REQUEST', from: this.id };
                client.write(JSON.stringify(req) + '\n');
            });
            client.unref();

            let buffer = '';
            let snapshot: { data: Record<string, string>; version: number } | undefined;
            const chunks: Map<number, Record<string, string>> = new Map();
            let expectedTotal = 0;
            let doneChecksum: string | undefined;
            let snapshotVersion = 0;
            let finished = false;
            const finish = (ok: boolean) => {
                if (finished) return;
                finished = true;
                resolve(ok);
            };
            const applySnapshot = () => {
                if (!snapshot) return false;
                if (snapshot.version >= this.storage.getVersion()) {
                    this.storage.load(snapshot.data);
                    this.storage.setVersion(snapshot.version);
                }
                return true;
            };

            const tryAssemble = () => {
                if (expectedTotal > 0 && doneChecksum && chunks.size === expectedTotal) {
                    const merged: Record<string, string> = {};
                    Array.from(chunks.keys())
                        .sort((a, b) => a - b)
                        .forEach((s) => Object.assign(merged, chunks.get(s)));
                    const checksum = this.computeChecksum(merged);
                    if (checksum === doneChecksum) {
                        snapshot = { data: merged, version: snapshotVersion };
                    }
                }
            };

            client.on('data', (chunk) => {
                buffer += chunk.toString();
                while (true) {
                    const idx = buffer.indexOf('\n');
                    if (idx < 0) break;
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    if (!raw.trim()) continue;
                    try {
                        const msg = JSON.parse(raw) as Message;
                        if (msg.type === 'SNAPSHOT_CHUNK') {
                            const snap = msg as SnapshotChunkMessage;
                            if (snap.seq && snap.total) {
                                expectedTotal = snap.total;
                                chunks.set(snap.seq, snap.data);
                                tryAssemble();
                            } else {
                                snapshot = { data: snap.data, version: snapshotVersion };
                            }
                        } else if (msg.type === 'SNAPSHOT_DONE') {
                            doneChecksum = (msg as SnapshotDoneMessage).checksum;
                            snapshotVersion = (msg as SnapshotDoneMessage).version ?? 0;
                            if (expectedTotal === 0) {
                                // no chunks? treat as empty snapshot
                                snapshot = { data: {}, version: snapshotVersion };
                            }
                            tryAssemble();
                        } else if (msg.type === 'RESPONSE') {
                            if (msg.success) {
                                applySnapshot();
                                client.end();
                                finish(!!snapshot);
                                return;
                            }
                        }
                    } catch {
                        // ignore parsing errors, try next line
                    }
                }
            });

            client.setTimeout(2000, () => {
                client.destroy();
                finish(applySnapshot());
            });

            client.on('error', () => finish(applySnapshot()));
            client.on('close', () => {
                finish(applySnapshot());
            });
        });
    }

    private pickReplicas(key: string): { primary: number; secondary: number } {
        // Prefer alive nodes (self + peers with fresh heartbeat); if none, fall back to self only
        const nodes = this.getAliveNodes();
        const h = this.simpleHash(key);
        const idx = h % nodes.length;
        const primary = nodes[idx];
        const secondary = nodes[(idx + 1) % nodes.length] ?? primary;
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
        return this.replication.replicatePut(port, key, value);
    }

    private async replicateDeleteToSecondary(port: number, key: string): Promise<boolean> {
        return this.replication.replicateDelete(port, key);
    }

    private async sendToPeer(port: number, msg: Message): Promise<ResponseMessage> {
        const now = Date.now();
        const openUntil = this.breakerOpenUntil.get(port) ?? 0;
        if (now < openUntil) {
            return { type: 'RESPONSE', success: false, error: 'Circuit open' };
        }

        const res = await new Promise<ResponseMessage>((resolve) => {
            const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
                client.write(JSON.stringify(msg) + '\n');
            });
            client.unref();

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

            client.setTimeout(2000, () => {
                client.destroy();
                resolve({ type: 'RESPONSE', success: false, error: 'Timeout' });
            });

            client.on('error', (err) => {
                resolve({ type: 'RESPONSE', success: false, error: err.message });
            });
        });

        this.handleBreakerResult(port, res.success === true);
        return res;
    }

    private handleBreakerResult(port: number, success: boolean) {
        if (success) {
            this.peerFailures.delete(port);
            this.breakerOpenUntil.delete(port);
            return;
        }
        const fails = (this.peerFailures.get(port) ?? 0) + 1;
        this.peerFailures.set(port, fails);
        if (fails >= 3) {
            const backoff = this.breakerBaseMs * Math.pow(2, Math.min(fails - 3, 4));
            this.breakerOpenUntil.set(port, Date.now() + backoff);
        }
    }

    private trackOp(opId: string) {
        const now = Date.now();
        this.seenOps.set(opId, now);
        // prune old
        for (const [id, ts] of Array.from(this.seenOps.entries())) {
            if (now - ts > this.opTtlMs) this.seenOps.delete(id);
        }
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
        // Avoid keeping the event loop alive solely for heartbeats in tests
        this.heartbeatTimer.unref?.();
    }

    private getAliveNodes(): number[] {
        const now = Date.now();
        const members = this.membership.getPeers();
        const alivePeers = members.filter((p) => {
            const last = this.lastSeen.get(p) ?? 0;
            return now - last <= this.heartbeatTimeoutMs;
        });
        const alive = [this.port, ...alivePeers];
        const uniq = Array.from(new Set(alive)).sort((a, b) => a - b);
        return uniq.length ? uniq : [this.port];
    }

    // Best-effort rebalance: move keys whose primary changed away from this node
    private async rebalanceData(): Promise<void> {
        const buckets: Map<number, { entries: Record<string, string>; keys: string[] }> = new Map();

        for (const [key, value] of this.storage.entries()) {
            const { primary, secondary } = this.pickReplicas(key);
            if (primary !== this.port) {
                const bucket = buckets.get(primary) ?? { entries: {}, keys: [] };
                bucket.entries[key] = value;
                bucket.keys.push(key);
                buckets.set(primary, bucket);
            } else {
                await this.replicateToSecondary(secondary, key, value);
            }
        }

        for (const [target, bucket] of buckets.entries()) {
            const res = await this.sendToPeer(target, { type: 'REBALANCE_PUSH', entries: bucket.entries, from: this.port });
            if (res.success) {
                bucket.keys.forEach((k) => this.storage.delete(k));
            }
        }
    }

    private broadcastJoin() {
        const peers = Array.from(new Set([...this.membership.getPeers(), this.port]));
        const msg: MembershipMessage = { type: 'JOIN', nodeId: String(this.port), epoch: this.membership.getEpoch(), peers };
        this.peers.forEach((p) => this.sendToPeer(p, msg).catch(() => undefined));
    }

    private broadcastLeave() {
        const peers = Array.from(new Set([...this.membership.getPeers(), this.port]));
        const msg: MembershipMessage = { type: 'LEAVE', nodeId: String(this.port), epoch: this.membership.getEpoch(), peers };
        this.peers.forEach((p) => this.sendToPeer(p, msg).catch(() => undefined));
    }

    private broadcastMembership(epoch: number, peers: number[]) {
        const snapshot = Array.from(new Set([...peers, this.port]));
        const msg: MembershipMessage = { type: 'MEMBERSHIP_SNAPSHOT', nodeId: String(this.port), epoch, peers: snapshot };
        this.peers.forEach((p) => this.sendToPeer(p, msg).catch(() => undefined));
    }
}

// Factory helper used by bootstrap code
export const createServer = (port = 3000, id = 'node', peers: number[] = []): Server => new Server({ port, id, peers });