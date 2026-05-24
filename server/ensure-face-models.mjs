/**
 * Копирует веса face-api в server/public/models.
 * Файл в server/ — всегда в деплое Timeweb/Docker (postinstall в package.json убран:
 * на этапе npm ci скрипты из /scripts ещё могут отсутствовать).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(serverDir, '..');
const dst = path.join(serverDir, 'public/models');

const REQUIRED = [
  'ssd_mobilenetv1_model.bin',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model.bin',
  'face_recognition_model.bin',
];

const MIN_SIZES = {
  'ssd_mobilenetv1_model.bin': 5_000_000,
  'tiny_face_detector_model.bin': 100_000,
  'face_landmark_68_model.bin': 300_000,
  'face_recognition_model.bin': 5_000_000,
};

function findModelSource() {
  const candidates = [
    path.join(root, 'node_modules/@vladmandic/face-api/model'),
    path.join(root, 'client/node_modules/@vladmandic/face-api/model'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'face_recognition_model.bin'))) return dir;
  }
  return null;
}

function modelsOk() {
  for (const name of REQUIRED) {
    const p = path.join(dst, name);
    if (!fs.existsSync(p)) return false;
    if (fs.statSync(p).size < (MIN_SIZES[name] || 1000)) return false;
  }
  return true;
}

function copyFrom(src) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

const src = findModelSource();
if (modelsOk()) {
  console.log('face-models: OK (server/public/models)');
  process.exit(0);
}

if (!src) {
  console.error(
    'face-models: не найден @vladmandic/face-api/model.\n'
    + '  Выполните npm install в корне проекта (зависимость @vladmandic/face-api).\n'
    + '  Либо загрузите готовый пакет с server/public/models/*.bin',
  );
  process.exit(1);
}

console.log('face-models: копирование из', src);
copyFrom(src);

if (!modelsOk()) {
  console.error('face-models: после копирования файлы .bin неполные или отсутствуют');
  process.exit(1);
}

console.log('face-models: скопировано в server/public/models');
