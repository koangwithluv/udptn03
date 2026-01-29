import { Storage } from './storage';

// Minimal replication stub for this simplified setup
export class Replication {
    constructor(private readonly storage: Storage) {}

    public async replicate(key: string, value: string): Promise<void> {
        this.storage.put(key, value);
    }

    public async replicateDelete(key: string): Promise<void> {
        this.storage.delete(key);
    }
}