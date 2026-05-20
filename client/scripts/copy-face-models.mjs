import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules/@vladmandic/face-api/model');

const REQUIRED_BINS = [
  'ssd_mobilenetv1_model.bin',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model.bin',
  'face_recognition_model.bin',
];

function copyModelsTo(dst) {
  if (!fs.existsSync(src)) {
    console.warn('copy-face-models: пакет @vladmandic/face-api/model не найден — выполните npm ci в client/');
    return false;
  }
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  for (const name of REQUIRED_BINS) {
    const p = path.join(dst, name);
    if (!fs.existsSync(p) || fs.statSync(p).size < 1000) {
      console.warn(`copy-face-models: отсутствует или повреждён ${name} в ${dst}`);
      return false;
    }
  }
  return true;
}

const clientPublic = path.join(root, 'public/models');
const serverPublic = path.join(root, '../server/public/models');

const okClient = copyModelsTo(clientPublic);
const okServer = copyModelsTo(serverPublic);

if (okClient && okServer) {
  console.log('copy-face-models: OK → client/public/models и server/public/models');
} else {
  process.exitCode = 1;
}
