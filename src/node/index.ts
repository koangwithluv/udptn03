import { createServer } from './server';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const port = Number(get('--port', '3000'));
  const id = get('--id', `node-${port}`)!;
  const peers = get('--peers', '')!.split(',').filter(Boolean).map(p => Number(p));
  return { port, id, peers };
}

async function main() {
  const { port, id, peers } = parseArgs();
  const server = createServer(port, id, peers);
  await server.start();
  console.log(`Node ${id} listening on ${port}, peers: ${peers.join(',') || '(none)'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});