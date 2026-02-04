export class Storage {
    private store: Map<string, string>;

    constructor() {
        this.store = new Map();
    }

    public put(key: string, value: string): void {
        this.store.set(key, value);
    }

    public get(key: string): string | undefined {
        return this.store.get(key);
    }

    public delete(key: string): void {
        this.store.delete(key);
    }

    public entries(): IterableIterator<[string, string]> {
        return this.store.entries();
    }
}