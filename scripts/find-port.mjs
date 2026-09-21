// Print the first free TCP port at or above the one given (default 5199).
//
// Written once in Node rather than three times in bash/PowerShell/batch: Node
// is already a hard dependency of the project, so the start scripts can all
// share this and behave identically.
//
// Usage: node scripts/find-port.mjs [start] [tries]

import net from 'node:net';

const start = Number(process.argv[2]) || 5199;
const tries = Number(process.argv[3]) || 60;

/**
 * Is anything actually listening?
 *
 * This is the primary check, and a bind test is not enough on its own: Windows
 * happily lets you bind 127.0.0.1:P while another process holds 0.0.0.0:P, so
 * a bind test alone reports a busy port as free. Connecting finds the listener
 * no matter which address it bound.
 */
function inUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const finish = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(400);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** And can we actually take it? Catches ports reserved or blocked by the OS. */
function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port); // wildcard, the same way a dev server would claim it
  });
}

async function isFree(port) {
  if (await inUse(port)) return false;
  return canBind(port);
}

let chosen = start;
for (let p = start; p < start + tries; p++) {
  if (await isFree(p)) {
    chosen = p;
    break;
  }
}

// If every port in the range was busy we still print the start port, and Vite
// is left to report the problem itself rather than this failing cryptically.
process.stdout.write(String(chosen));
