import { createServer } from './server';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    // Supports "--flag value" and "--flag=value"
    const exact = args.indexOf(flag);
    if (exact >= 0 && args[exact + 1]) return args[exact + 1];
    const pref = `${flag}=`;
    const withEq = args.find((a) => a.startsWith(pref));
    if (withEq) return withEq.slice(pref.length);
    return def;
  };
  const port = Number(get('--port', '3000'));
  const id = get('--id', `node-${port}`)!;

  // Cleanly parse peers, dropping invalid/NaN entries and self-port
  const peers = get('--peers', '')!
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p !== port);

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