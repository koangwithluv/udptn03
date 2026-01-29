import { Node } from './node';

export class Membership {
    private nodes: Set<Node>;

    constructor() {
        this.nodes = new Set<Node>();
    }

    public addNode(node: Node): void {
        this.nodes.add(node);
        this.notifyNodes();
    }

    public removeNode(node: Node): void {
        this.nodes.delete(node);
        this.notifyNodes();
    }

    public getNodes(): Node[] {
        return Array.from(this.nodes);
    }

    private notifyNodes(): void {
        // Logic to notify other nodes about the membership changes
        this.nodes.forEach(node => {
            // Send membership update to each node
        });
    }
}