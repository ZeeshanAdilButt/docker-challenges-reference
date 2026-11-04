// Scan some ports on this computer, from 127.0.0.1 and from the computer's other addresses.
// Run: node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/scan.mjs 41001 41002
//
// Use it ONLY on ports of containers you started yourself. It tries one TCP connection per port and address.
// A port that answers on an address other than 127.0.0.1 can be reached by other computers on your network.

import { formatScan, lanAddresses, scanPorts } from '../lib.mjs';

const ports = process.argv.slice(2).map(Number);
if (ports.length === 0 || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
  console.error('Usage: node scan.mjs <port> [<port> ...]   (ports of your own containers)');
  process.exit(2);
}
const addresses = lanAddresses();
console.log(formatScan(await scanPorts(ports, addresses), addresses));
