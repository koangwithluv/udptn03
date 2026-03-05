import * as readline from 'readline';
import * as net from 'net';

type Command = 'PUT' | 'GET' | 'DELETE';

export class Client {
    constructor(private host = '127.0.0.1', private ports: number[] = [3000]) {}

    private async sendWithFailover<T = any>(msg: object): Promise<T> {
        let lastErr: any;
        for (const port of this.ports) {
            try {
                const res = await this.sendOnce<T>(port, msg);
                return res;
            } catch (err) {
                lastErr = err;
                // try next port
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

    public async put(key: string, value: string): Promise<any> {
        return this.sendWithFailover({ type: 'PUT' as Command, key, value });
    }

    public async get(key: string): Promise<any> {
        return this.sendWithFailover({ type: 'GET' as Command, key });
    }

    public async delete(key: string): Promise<any> {
        return this.sendWithFailover({ type: 'DELETE' as Command, key });
    }
}

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

if (require.main === module) {
    const portsStr = defaultPorts.join(',');
    console.log(`CLI connecting to ${defaultHost}:[${portsStr}]`);
    promptUser();
}