import { createServer } from './server';

const startNode = async () => {
    const server = createServer(3000);
    await server.start();
    console.log('Node is running on port 3000');
};

startNode().catch(err => {
    console.error('Failed to start the node:', err);
});