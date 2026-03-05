import fs from 'fs';

export class Storage {
    private store: Map<string, string>;
    private snapshotPath?: string;
    private walPath?: string;
    private version: number;
    private readonly skipSnapshot: boolean;

    constructor(snapshotPath?: string, walPath?: string) {
        this.store = new Map();
        this.snapshotPath = snapshotPath;
        this.walPath = walPath;
        this.version = 0;
        this.skipSnapshot = process.env.KV_FAULT_SKIP_SNAPSHOT === '1';
        if (this.snapshotPath) {
            this.loadFromDisk();
        }
        if (this.walPath) {
            this.replayWal();
        }
    }

    public put(key: string, value: string): void {
        this.store.set(key, value);
        this.version++;
        this.appendWal({ op: 'put', key, value });
        this.persist();
    }

    public get(key: string): string | undefined {
        return this.store.get(key);
    }

    public delete(key: string): void {
        this.store.delete(key);
        this.version++;
        this.appendWal({ op: 'del', key });
        this.persist();
    }

    public entries(): IterableIterator<[string, string]> {
        return this.store.entries();
    }

    public load(data: Record<string, string>): void {
        this.store.clear();
        for (const [k, v] of Object.entries(data)) {
            this.store.set(k, v);
        }
        this.persist(true);
    }

    public setVersion(ver: number): void {
        if (Number.isFinite(ver) && ver >= this.version) this.version = ver;
    }

    public getVersion(): number {
        return this.version;
    }

    public persist(force = false): void {
        if (!this.snapshotPath) return;
        if (!force && this.skipSnapshot) return;
        try {
            fs.writeFileSync(
                this.snapshotPath,
                JSON.stringify({ version: this.version, data: Object.fromEntries(this.store) }),
                'utf-8'
            );
            if (force && this.walPath) fs.writeFileSync(this.walPath, '', 'utf-8');
        } catch {
            // best-effort; ignore write errors for now
        }
    }

    private loadFromDisk(): void {
        if (!this.snapshotPath) return;
        if (!fs.existsSync(this.snapshotPath)) return;
        try {
            const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
            const parsed = JSON.parse(raw) as { version?: number; data: Record<string, string> } | Record<string, string>;
            const dataObj = 'data' in parsed ? parsed.data : (parsed as Record<string, string>);
            const ver = 'version' in parsed && typeof parsed.version === 'number' ? parsed.version : 0;
            this.store.clear();
            for (const [k, v] of Object.entries(dataObj)) this.store.set(k, v);
            this.version = Math.max(this.version, ver);
        } catch {
            // ignore corrupt snapshot
        }
    }

    private appendWal(entry: { op: 'put' | 'del'; key: string; value?: string }): void {
        if (!this.walPath) return;
        try {
            fs.appendFileSync(this.walPath, JSON.stringify(entry) + '\n');
        } catch {
            // ignore
        }
    }

    private replayWal(): void {
        if (!this.walPath) return;
        if (!fs.existsSync(this.walPath)) return;
        try {
            const lines = fs.readFileSync(this.walPath, 'utf-8').split('\n').filter(Boolean);
            for (const line of lines) {
                const entry = JSON.parse(line) as { op: 'put' | 'del'; key: string; value?: string };
                if (entry.op === 'put' && entry.value !== undefined) {
                    this.store.set(entry.key, entry.value);
                    this.version++;
                }
                if (entry.op === 'del') {
                    this.store.delete(entry.key);
                    this.version++;
                }
            }
        } catch {
            // ignore
        }
    }
}
