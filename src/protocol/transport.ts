import * as net from 'net';
import { Message, RequestMessage } from './messages';

export class Transport {
    private server: net.Server;
    private clients: Set<net.Socket>;

    constructor(port: number) {
        this.server = net.createServer(this.handleConnection.bind(this));
        this.clients = new Set();
        this.server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    }

    private handleConnection(socket: net.Socket) {
        this.clients.add(socket);
        console.log('New client connected');

        socket.on('data', (data) => {
            const message: Message = JSON.parse(data.toString());
            this.handleMessage(message, socket);
        });

        socket.on('close', () => {
            this.clients.delete(socket);
            console.log('Client disconnected');
        });
    }

    private handleMessage(message: Message, socket: net.Socket) {
        if (!this.isRequestMessage(message)) {
            console.error('Unsupported or non-request message received');
            return;
        }

        switch (message.type) {
            case 'PUT':
                this.handlePut(message);
                break;
            case 'GET':
                this.handleGet(message, socket);
                break;
            case 'DELETE':
                this.handleDelete(message);
                break;
        }
    }

    private handlePut(message: RequestMessage) {
        // Logic to handle PUT requests
        console.log(`PUT request for key: ${message.key}`);
        // Forward to storage or replication logic
    }

    private handleGet(message: RequestMessage, socket: net.Socket) {
        // Logic to handle GET requests
        console.log(`GET request for key: ${message.key}`);
        // Send response back to client
        const response = JSON.stringify({ key: message.key, value: 'someValue' });
        socket.write(response);
    }

    private handleDelete(message: RequestMessage) {
        // Logic to handle DELETE requests
        console.log(`DELETE request for key: ${message.key}`);
        // Forward to storage or replication logic
    }

    public sendMessage(message: Message, socket: net.Socket) {
        socket.write(JSON.stringify(message));
    }

    private isRequestMessage(message: Message): message is RequestMessage {
        return message.type === 'PUT' || message.type === 'GET' || message.type === 'DELETE';
    }
}