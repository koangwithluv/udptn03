import { createServer, Server } from '../src/node/server';
import { Client } from '../src/client/cli';

describe('Client Module Tests', () => {
    let server: Server;

    beforeAll(async () => {
        server = await createServer();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('PUT request should store key-value pair', async () => {
        const client = new Client();
        const response = await client.put('testKey', 'testValue');
        expect(response).toEqual({ success: true });
    });

    test('GET request should retrieve the value for a key', async () => {
        const client = new Client();
        await client.put('testKey', 'testValue');
        const response = await client.get('testKey');
        expect(response).toEqual({ value: 'testValue' });
    });

    test('DELETE request should remove the key-value pair', async () => {
        const client = new Client();
        await client.put('testKey', 'testValue');
        const deleteResponse = await client.delete('testKey');
        expect(deleteResponse).toEqual({ success: true });
        const getResponse = await client.get('testKey');
        expect(getResponse).toEqual({ value: null });
    });
});