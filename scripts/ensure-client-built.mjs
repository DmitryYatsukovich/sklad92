import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  path.join(root, 'server/public/index.html'),
  path.join(root, 'client/dist/index.html'),
];

if (candidates.some((p) => fs.existsSync(p))) {
  console.log('Client build OK:', candidates.find((p) => fs.existsSync(p)));
  process.exit(0);
}

console.log('Client build missing — building (node_modules from Build step)...');
execSync('npm run build --prefix client', { cwd: root, stdio: 'inherit' });

if (!candidates.some((p) => fs.existsSync(p))) {
  console.error('FATAL: client build did not produce index.html');
  process.exit(1);
}
