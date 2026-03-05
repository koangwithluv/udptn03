import { Storage } from './storage';
import { ReplicationMessage, ResponseMessage } from '../protocol/messages';
import * as net from 'net';

/**
 * Simple replication helper.
 * - If targetPort === selfPort: apply locally.
 * - Otherwise: open a TCP connection, send REPL_PUT/REPL_DEL and wait for RESPONSE.
 */
export class Replication {
    constructor(private readonly storage: Storage, private readonly selfPort: number, private readonly host = '127.0.0.1') {}

    public async replicatePut(targetPort: number, key: string, value: string): Promise<boolean> {
        if (targetPort === this.selfPort) {
            this.storage.put(key, value);
            return true;
        }
        const msg: ReplicationMessage = { type: 'REPL_PUT', key, value, opId: this.newOpId(key) };
        const res = await this.sendWithRetry(targetPort, msg);
        return res.success === true;
    }

    public async replicateDelete(targetPort: number, key: string): Promise<boolean> {
        if (targetPort === this.selfPort) {
            this.storage.delete(key);
            return true;
        }
        const msg: ReplicationMessage = { type: 'REPL_DEL', key, opId: this.newOpId(key) };
        const res = await this.sendWithRetry(targetPort, msg);
        return res.success === true;
    }

    private newOpId(key: string): string {
        return `${this.selfPort}-${key}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    private async sendWithRetry(port: number, msg: ReplicationMessage, attempts = 3, backoffMs = 100): Promise<ResponseMessage> {
        let last: ResponseMessage = { type: 'RESPONSE', success: false };
        for (let i = 0; i < attempts; i++) {
            last = await this.send(port, msg);
            if (last.success) return last;
            await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, i)));
        }
        return last;
    }

    private async send(port: number, msg: ReplicationMessage): Promise<ResponseMessage> {
        return new Promise<ResponseMessage>((resolve) => {
            const client = net.createConnection({ port, host: this.host }, () => {
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
    }
}