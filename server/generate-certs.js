#!/usr/bin/env node
/**
 * Генерация самоподписанного сертификата для HTTPS (камера на телефоне).
 * Сертификат действителен 365 дней.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Сертификаты уже есть в server/certs/');
  process.exit(0);
}

execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
  { stdio: 'inherit' }
);
console.log('Сертификаты созданы: server/certs/key.pem, server/certs/cert.pem');
