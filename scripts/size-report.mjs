// Prints the size of each built file, minified and gzipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.js')) files.push(path);
  }
};
walk('dist');
let total = 0;
let totalGzip = 0;
for (const path of files.sort()) {
  const code = readFileSync(path);
  const gzip = gzipSync(code, { level: 9 }).length;
  total += code.length;
  totalGzip += gzip;
  console.log(`${path.padEnd(48)} ${(code.length / 1024).toFixed(1).padStart(7)} KB   gzip ${(gzip / 1024).toFixed(1).padStart(6)} KB`);
}
console.log(`${'total'.padEnd(48)} ${(total / 1024).toFixed(1).padStart(7)} KB   gzip ${(totalGzip / 1024).toFixed(1).padStart(6)} KB`);
