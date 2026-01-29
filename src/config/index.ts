import { Config } from './types';

const config: Config = {
    network: {
        host: 'localhost',
        port: 3000,
        protocol: 'tcp',
    },
    replication: {
        factor: 2,
    },
    heartbeat: {
        interval: 5000,
        timeout: 10000,
    },
    storage: {
        maxSize: 10000, // Maximum number of key-value pairs
    },
};

export default config;