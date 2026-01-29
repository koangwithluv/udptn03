import { Node } from '../src/node/node';

describe('Node Module', () => {
    let node: Node;

    beforeEach(() => {
        node = new Node();
    });

    it('should initialize the node correctly', () => {
        expect(node).toBeDefined();
        expect(node.isRunning).toBe(true);
    });

    it('should handle PUT requests', async () => {
        const key = 'testKey';
        const value = 'testValue';
        await node.put(key, value);
        const retrievedValue = await node.get(key);
        expect(retrievedValue).toBe(value);
    });

    it('should handle GET requests for non-existing keys', async () => {
        const retrievedValue = await node.get('nonExistingKey');
        expect(retrievedValue).toBeUndefined();
    });

    it('should handle DELETE requests', async () => {
        const key = 'deleteKey';
        const value = 'deleteValue';
        await node.put(key, value);
        await node.delete(key);
        const retrievedValue = await node.get(key);
        expect(retrievedValue).toBeUndefined();
    });

    it('should replicate data to other nodes', async () => {
        const key = 'replicateKey';
        const value = 'replicateValue';
        await node.put(key, value);
        
        // Simulate another node
        const anotherNode = new Node();
        await anotherNode.replicateData(key, value);
        
        const retrievedValue = await anotherNode.get(key);
        expect(retrievedValue).toBe(value);
    });

    it('should recover data from another node after failure', async () => {
        const key = 'recoverKey';
        const value = 'recoverValue';
        await node.put(key, value);
        
        // Simulate node failure
        node.shutdown();
        
        // Simulate recovery
        await node.recoverFromAnotherNode();
        const retrievedValue = await node.get(key);
        expect(retrievedValue).toBe(value);
    });
});