import * as readline from 'readline';
import * as net from 'net';

type Command = 'PUT' | 'GET' | 'DELETE';

export class Client {
    constructor(private host = '127.0.0.1', private ports: number[] = [3000]) {}

    private async sendWithFailover<T = any>(msg: object, retriesPerPort = 2): Promise<T> {
        let lastErr: any;
        for (const port of this.ports) {
            for (let i = 0; i < retriesPerPort; i++) {
                try {
                    const res = await this.sendOnce<T>(port, msg);
                    return res;
                } catch (err) {
                    lastErr = err;
                    const backoff = 50 * (i + 1);
                    await new Promise((r) => setTimeout(r, backoff));
                }
            }
        }
        throw lastErr ?? new Error('No ports available');
    }

    private sendOnce<T = any>(port: number, msg: object): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const socket = net.createConnection({ host: this.host, port });
            let buffer = '';

            socket.on('connect', () => {
                socket.write(JSON.stringify(msg) + '\n');
            });

            // Prevent sockets from keeping the event loop alive in tests
            socket.unref();
            socket.setTimeout(2000, () => {
                socket.destroy();
                reject(new Error('Timeout'));
            });

            socket.on('data', (chunk) => {
                buffer += chunk.toString();
                const idx = buffer.indexOf('\n');
                if (idx >= 0) {
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 1);
                    try {
                        const parsed = JSON.parse(raw) as T;
                        socket.end();
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                }
            });

            socket.on('error', (err) => reject(err));
        });
    }

    public async put(key: string, value: string): Promise<{ success: boolean }> {
        const res = await this.sendWithFailover<{ type?: string; success?: boolean }>({ type: 'PUT' as Command, key, value });
        return { success: res?.success === true };
    }

    public async get(key: string): Promise<{ value: string | null }> {
        const res = await this.sendWithFailover<{ data?: string; success?: boolean }>({ type: 'GET' as Command, key });
        return { value: res?.data ?? null };
    }

    public async delete(key: string): Promise<{ success: boolean }> {
        const res = await this.sendWithFailover<{ type?: string; success?: boolean }>({ type: 'DELETE' as Command, key });
        return { success: res?.success === true };
    }
}

if (require.main === module && !process.env.JEST_WORKER_ID) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const defaultHost = process.env.KV_HOST || '127.0.0.1';
    const portsEnv = process.env.KV_PORTS || process.env.KV_PORT || '3000';
    const defaultPorts = portsEnv.split(',').map((p) => Number(p.trim())).filter((p) => Number.isFinite(p));
    const client = new Client(defaultHost, defaultPorts.length ? defaultPorts : [3000]);

    const promptUser = () => {
        rl.question('Enter command (PUT key value, GET key, DELETE key): ', async (input) => {
            const [command = '', key, ...rest] = input.trim().split(' ');
            const value = rest.join(' ');

            try {
                switch (command.toUpperCase()) {
                    case 'PUT': {
                        if (!key || !value) {
                            console.log('Usage: PUT key value');
                            break;
                        }
                        const res = await client.put(key, value);
                        console.log('Response:', res);
                        break;
                    }
                    case 'GET': {
                        if (!key) {
                            console.log('Usage: GET key');
                            break;
                        }
                        const res = await client.get(key);
                        console.log('Response:', res);
                        break;
                    }
                    case 'DELETE': {
                        if (!key) {
                            console.log('Usage: DELETE key');
                            break;
                        }
                        const res = await client.delete(key);
                        console.log('Response:', res);
                        break;
                    }
                    default:
                        console.log('Unknown command. Please use PUT, GET, or DELETE.');
                }
            } catch (error: any) {
                console.error('Error:', error.message ?? error);
            }

            promptUser();
        });
    };

    const portsStr = defaultPorts.join(',');
    console.log(`CLI connecting to ${defaultHost}:[${portsStr}]`);
    promptUser();
}