#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, 'server/certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Нет сертификатов в server/certs/. Выполните: npm run generate-certs');
  process.exit(1);
}

const clientRoot = path.join(root, 'client');
const viteCli = path.join(clientRoot, 'node_modules/vite/bin/vite.js');
if (!fs.existsSync(viteCli)) {
  console.error('Установите зависимости клиента: cd client && npm install');
  process.exit(1);
}

const api = spawn(process.execPath, [path.join(root, 'server/index.js')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env },
});

let clientProc;

function shutdown() {
  if (clientProc && !clientProc.killed) clientProc.kill('SIGTERM');
  if (api && !api.killed) api.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

api.on('exit', (code) => {
  if (clientProc && !clientProc.killed) clientProc.kill('SIGTERM');
  process.exit(code ?? 0);
});

setTimeout(() => {
  clientProc = spawn(process.execPath, [viteCli, '--host'], {
    cwd: clientRoot,
    stdio: 'inherit',
    env: { ...process.env, DEV_HTTPS: '1' },
  });
  clientProc.on('exit', () => {
    if (!api.killed) api.kill('SIGTERM');
  });
}, 1200);
