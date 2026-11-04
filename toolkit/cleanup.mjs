// Remove everything that challenge N created, and nothing else.
// Run: node toolkit/cleanup.mjs 3
// It removes only containers, networks and volumes labelled dkr.challenge=3.
// It never runs "docker system prune" and never touches images.

import { cleanup, leftovers, assertDocker } from './docker.js';

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n < 0) {
  console.error('Usage: node toolkit/cleanup.mjs <challenge number>');
  process.exit(2);
}
assertDocker();
const removed = cleanup(n);
console.log(`Removed for challenge ${n}: ${removed.containers.length} containers, ${removed.networks.length} networks, ${removed.volumes.length} volumes.`);
const left = leftovers(n);
console.log(`Still labelled dkr.challenge=${n}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`);
process.exit(left.containers + left.networks + left.volumes === 0 ? 0 : 1);
