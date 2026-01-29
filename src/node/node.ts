export class Node {
    private store: Map<string, string>;
    public isRunning: boolean;
    private static globalReplica: Map<string, string> = new Map();

    constructor() {
        this.store = new Map<string, string>();
        this.isRunning = true;
    }

    public async put(key: string, value: string): Promise<void> {
        this.ensureRunning();
        this.store.set(key, value);
        Node.globalReplica.set(key, value);
    }

    public async get(key: string): Promise<string | undefined> {
        this.ensureRunning();
        return this.store.get(key);
    }

    public async delete(key: string): Promise<void> {
        this.ensureRunning();
        this.store.delete(key);
        Node.globalReplica.delete(key);
    }

    public async replicateData(key: string, value: string): Promise<void> {
        // Simulate receiving replicated data from another node
        this.store.set(key, value);
        Node.globalReplica.set(key, value);
    }

    public shutdown(): void {
        this.isRunning = false;
        this.store.clear();
    }

    public async recoverFromAnotherNode(): Promise<void> {
        // Simulate recovery by copying from global replica
        this.store = new Map<string, string>(Node.globalReplica);
        this.isRunning = true;
    }

    // Stub: return list of replicas (empty for now)
    public getReplicas(): string[] {
        return [];
    }

    // Store data directly, used by recovery flow
    public storeData(key: string, value: string | undefined): void {
        if (value === undefined) return;
        this.store.set(key, value);
        Node.globalReplica.set(key, value);
    }

    private ensureRunning(): void {
        if (!this.isRunning) {
            throw new Error('Node is not running');
        }
    }
}
