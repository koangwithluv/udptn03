import { createServer, Server } from '../src/node/server';
import { Client } from '../src/client/cli';
import fs from 'fs';

const cleanupFiles = (ports: number[]) => {
    for (const p of ports) {
        const snap = `data-${p}.json`;
        const wal = `data-${p}.wal`;
        if (fs.existsSync(snap)) fs.unlinkSync(snap);
        if (fs.existsSync(wal)) fs.unlinkSync(wal);
    }
};

describe('Integration: multi-node replication', () => {
    let s1: Server;
    let s2: Server;
    const port1 = 4100;
    const port2 = 4101;

    beforeAll(async () => {
        cleanupFiles([port1, port2]);
        s1 = createServer(port1, 'node-1', [port2]);
        s2 = createServer(port2, 'node-2', [port1]);
        await Promise.all([s1.start(), s2.start()]);
    });

    afterAll(async () => {
        await Promise.all([s1.stop(), s2.stop()]);
        cleanupFiles([port1, port2]);
    });

    test('PUT on node1 is readable via node2 client', async () => {
        const client1 = new Client('127.0.0.1', [port1]);
        const client2 = new Client('127.0.0.1', [port2]);

        await client1.put('ik', 'iv');
        const res = await client2.get('ik');
        expect(res).toEqual({ value: 'iv' });
    });

    test('Failover and recovery via snapshot + WAL', async () => {
        const client1 = new Client('127.0.0.1', [port1]);
        await client1.put('fk', 'fv');

        // stop node2 to simulate failure
        await s2.stop();

        // write more while node2 is down
        await client1.put('fk2', 'fv2');

        // restart node2, it should recover via snapshot/WAL from node1
        s2 = createServer(port2, 'node-2', [port1]);
        await s2.start();

        const client2 = new Client('127.0.0.1', [port2]);
        const resFromPrimary = await client1.get('fk2');
        const res1 = await client2.get('fk');
        const res2 = await client2.get('fk2');

        expect(resFromPrimary).toEqual({ value: 'fv2' });
        expect(res1).toEqual({ value: 'fv' });
        expect(res2).toEqual({ value: 'fv2' });
    });
});

describe('Fault injection: crash during PUT relies on WAL', () => {
    const port = 4202;
    let server: Server;

    beforeAll(async () => {
        cleanupFiles([port]);
        process.env.KV_FAULT_SKIP_SNAPSHOT = '1';
        server = createServer(port, 'node-fi', []);
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.KV_FAULT_SKIP_SNAPSHOT;
        cleanupFiles([port]);
    });

    test('replays WAL after restart when snapshot was skipped', async () => {
        const client = new Client('127.0.0.1', [port]);
        await client.put('crash-key', 'crash-val');

        // Simulate crash: stop without having written snapshot (fault flag skips persist)
        await server.stop();

        delete process.env.KV_FAULT_SKIP_SNAPSHOT;
        server = createServer(port, 'node-fi', []);
        await server.start();

        const client2 = new Client('127.0.0.1', [port]);
        const res = await client2.get('crash-key');
        expect(res).toEqual({ value: 'crash-val' });
    });
});
