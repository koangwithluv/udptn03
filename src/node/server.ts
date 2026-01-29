import * as net from 'net';
import { Storage } from './storage';
import { Replication } from './replication';
import { Membership } from './membership';
import logger from '../utils/logger';

export class Server {
    private server?: net.Server;
    private readonly storage: Storage;
    private readonly replication: Replication;
    private readonly membership: Membership;
    private readonly port: number;

    constructor(port = 0) {
        this.port = port;
        this.storage = new Storage();
        this.replication = new Replication(this.storage);
        this.membership = new Membership();
    }

    public async start(): Promise<void> {
        if (this.server) return;
        this.server = net.createServer(this.handleRequest.bind(this));
        await new Promise<void>((resolve) => {
            this.server!.listen(this.port, () => {
                logger.log(`Server listening on port ${this.port}`);
                resolve();
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.server) return;
        const closing = new Promise<void>((resolve, reject) => {
            this.server!.close((err) => (err ? reject(err) : resolve()));
        });
        this.server = undefined;
        await closing;
    }

    private handleRequest(socket: net.Socket) {
        socket.on('data', (data) => {
            const message = JSON.parse(data.toString());
            this.processMessage(message, socket);
        });
    }

    private processMessage(message: any, socket: net.Socket) {
        switch (message.type) {
            case 'PUT':
                this.handlePut(message.key, message.value, socket);
                break;
            case 'GET':
                this.handleGet(message.key, socket);
                break;
            case 'DELETE':
                this.handleDelete(message.key, socket);
                break;
            default:
                logger.log(`Unknown message type: ${message.type}`);
                socket.write(JSON.stringify({ error: 'Unknown message type' }));
        }
    }

    private handlePut(key: string, value: string, socket: net.Socket) {
        this.storage.put(key, value);
        this.replication.replicate(key, value);
        socket.write(JSON.stringify({ success: true }));
    }

    private handleGet(key: string, socket: net.Socket) {
        const value = this.storage.get(key);
        if (value !== undefined) {
            socket.write(JSON.stringify({ success: true, value }));
        } else {
            socket.write(JSON.stringify({ success: false, error: 'Key not found' }));
        }
    }

    private handleDelete(key: string, socket: net.Socket) {
        this.storage.delete(key);
        this.replication.replicateDelete(key);
        socket.write(JSON.stringify({ success: true }));
    }
}

// Factory helper used by tests and bootstrap code
export const createServer = (port = 3000): Server => new Server(port);