import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devHttps = process.env.DEV_HTTPS === '1';
const certDir = path.resolve(__dirname, '../server/certs');
const keyPath = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');

let httpsOption;
if (devHttps) {
  if (!fs.existsSync(keyPath) || !fs.existsSync(certFile)) {
    throw new Error(
      'DEV_HTTPS=1: нужны server/certs/key.pem и cert.pem — npm run generate-certs'
    );
  }
  httpsOption = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certFile),
  };
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('heic2any')) return 'heic2any';
          if (id.includes('@vladmandic/face-api') || id.includes('face-api')) return 'face-api';
        },
      },
    },
  },
  server: {
    port: 5173,
    host: devHttps ? true : undefined,
    https: httpsOption,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/models': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
