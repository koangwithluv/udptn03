import * as readline from 'readline';

export class Client {
    private store: Map<string, string>;

    constructor() {
        this.store = new Map<string, string>();
    }

    public async put(key: string, value: string): Promise<{ success: boolean }> {
        this.store.set(key, value);
        return { success: true };
    }

    public async get(key: string): Promise<{ value: string | null }> {
        const value = this.store.get(key) ?? null;
        return { value };
    }

    public async delete(key: string): Promise<{ success: boolean }> {
        this.store.delete(key);
        return { success: true };
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const client = new Client();

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
                    await client.put(key, value);
                    console.log(`Stored ${key} = ${value}`);
                    break;
                }
                case 'GET': {
                    if (!key) {
                        console.log('Usage: GET key');
                        break;
                    }
                    const result = await client.get(key);
                    console.log(`Value for ${key}: ${result.value ?? 'null'}`);
                    break;
                }
                case 'DELETE': {
                    if (!key) {
                        console.log('Usage: DELETE key');
                        break;
                    }
                    await client.delete(key);
                    console.log(`Deleted ${key}`);
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

// Only start the interactive prompt when this file is run directly (not when imported in tests)
if (require.main === module) {
    console.log('Welcome to the Distributed Key-Value Store CLI!');
    promptUser();
}