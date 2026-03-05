export class Membership {
    private peers: Set<number>;
    private listeners: Set<(peers: number[], epoch: number) => void>;
    private epoch: number;

    constructor(initialPeers: number[] = [], epoch = 0) {
        this.peers = new Set(initialPeers);
        this.listeners = new Set();
        this.epoch = epoch;
    }

    public addPeer(port: number, epoch?: number): void {
        if (!Number.isFinite(port)) return;
        if (epoch !== undefined && epoch < this.epoch) return;
        if (this.peers.has(port) && epoch === undefined) return;
        const changed = this.peers.has(port) ? false : true;
        this.peers.add(port);
        if (epoch !== undefined && epoch > this.epoch) {
            this.epoch = epoch;
        } else if (changed) {
            this.bumpEpoch();
            return;
        }
        if (changed || epoch !== undefined) this.notify();
    }

    public removePeer(port: number, epoch?: number): void {
        if (epoch !== undefined && epoch < this.epoch) return;
        if (!this.peers.has(port)) return;
        this.peers.delete(port);
        if (epoch !== undefined && epoch > this.epoch) {
            this.epoch = epoch;
            this.notify();
            return;
        }
        this.bumpEpoch();
    }

    public merge(peers: number[], epoch: number): void {
        if (epoch < this.epoch) return;
        if (epoch === this.epoch) {
            let changed = false;
            peers.forEach((p) => {
                if (!this.peers.has(p)) {
                    this.peers.add(p);
                    changed = true;
                }
            });
            if (changed) this.notify();
            return;
        }
        this.peers = new Set(peers);
        this.epoch = epoch;
        this.notify();
    }

    public getPeers(): number[] {
        return Array.from(this.peers).sort((a, b) => a - b);
    }

    public getEpoch(): number {
        return this.epoch;
    }

    public onChange(listener: (peers: number[], epoch: number) => void): void {
        this.listeners.add(listener);
    }

    private bumpEpoch() {
        this.epoch += 1;
        this.notify();
    }

    private notify(): void {
        const snapshot = this.getPeers();
        const e = this.epoch;
        this.listeners.forEach((listener) => listener(snapshot, e));
    }
}