import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import express from 'express';
import { spawnSync } from 'child_process';

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('unhandledRejection:', reason);
});
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { databaseConfigSource, isDatabaseConfigured } from './db/pool.js';

import auth from './routes/auth.js';
import users from './routes/users.js';
import materials from './routes/materials.js';
import operations from './routes/operations.js';
import reports from './routes/reports.js';
import stats from './routes/stats.js';
import cardUid from './routes/card-uid.js';
import attendance from './routes/attendance.js';
import settings from './routes/settings.js';
import roles from './routes/roles.js';
import actions from './routes/actions.js';
import { loadUser } from './middleware/auth.js';
import { ensureAdminUser } from './db/ensure-admin.js';
import { ensureSchema } from './db/ensure-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;
const dbStartupRetries = Math.max(
  1,
  Number.parseInt(process.env.DB_STARTUP_RETRIES || '20', 10) || 20,
);
const dbStartupRetryDelayMs = Math.max(
  1000,
  Number.parseInt(process.env.DB_STARTUP_RETRY_DELAY_MS || '3000', 10) || 3000,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Timeweb/Docker: фронт может быть в server/public или client/dist — ищем оба */
function resolveClientDist() {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../client/dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return candidates[0];
}

const clientDist = resolveClientDist();
const hasIndex = fs.existsSync(path.join(clientDist, 'index.html'));
const modelsDir = path.join(__dirname, 'public', 'models');

function faceModelsReady() {
  return fs.existsSync(path.join(modelsDir, 'face_recognition_model.bin'));
}

if (isProd) {
  console.log('NODE_ENV=production, static dir:', clientDist, 'index.html:', hasIndex);
  if (!hasIndex) {
    console.error('FATAL: index.html not found. Run build in Docker/Build step: npm run build');
  }
}

const app = express();
if (isProd) {
  app.set('trust proxy', 1);
}

/** Timeweb: HTTPS на прокси, secure cookie в production */
const useSecureCookies = process.env.HTTPS === 'true'
  || (isProd && process.env.COOKIE_SECURE !== 'false');

app.get('/api/health', (req, res) => {
  const publicDir = path.join(__dirname, 'public');
  const legacyDist = path.join(__dirname, '../client/dist');
  res.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV || 'development',
    staticDir: clientDist,
    hasClientDist: hasIndex,
    hasServerPublic: fs.existsSync(path.join(publicDir, 'index.html')),
    hasClientDistLegacy: fs.existsSync(path.join(legacyDist, 'index.html')),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    databaseConfigured: isDatabaseConfigured,
    databaseConfigSource,
    hasFaceModels: faceModelsReady(),
    modelsDir: faceModelsReady() ? modelsDir : null,
  });
});

app.use(cors({
  origin: isProd ? undefined : true,
  credentials: true,
}));
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '20mb';
const jsonParser = express.json({ limit: jsonBodyLimit });
// Не парсить JSON для multipart (загрузка файлов), иначе тело потребляется и multer падает
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return next();
  jsonParser(req, res, next);
});

const PgSession = connectPgSimple(session);
const sessionOptions = {
  name: 'warehouse.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  proxy: useSecureCookies,
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    sameSite: 'lax',
  },
};
if (isProd && isDatabaseConfigured) {
  sessionOptions.store = new PgSession({
    pool,
    createTableIfMissing: true,
    tableName: 'session',
  });
}
app.use(session(sessionOptions));

app.use(loadUser);

/** Модели face-api — не отдавать index.html вместо .bin (иначе ломается TensorFlow) */
app.use('/models', (req, res) => {
  const rel = decodeURIComponent(req.path.replace(/^\//, ''));
  if (!rel || rel.includes('..')) {
    return res.status(400).type('text/plain').send('Bad path');
  }
  const filePath = path.join(modelsDir, rel);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).type('text/plain').send(
      'Файл модели не найден. На сервере выполните: npm install && npm start',
    );
  }
  if (filePath.endsWith('.bin')) {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  if (isProd) res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(filePath);
});

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/materials', materials);
app.use('/api/operations', operations);
app.use('/api/reports', reports);
app.use('/api/stats', stats);
app.use('/api/card-uid', cardUid);
app.use('/api/attendance', attendance);
app.use('/api/settings', settings);
app.use('/api/roles', roles);
app.use('/api/actions', actions);

if (isProd) {
  if (hasIndex) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/models/')) {
        return res.status(404).type('text/plain').send(
          'Модели распознавания лиц не загружены. Выполните на сервере: npm install && npm start',
        );
      }
      res.sendFile(path.join(clientDist, 'index.html'), (err) => {
        if (err) {
          console.error('sendFile index.html:', err.message);
          next(err);
        }
      });
    });
  } else {
    app.get('*', (req, res) => {
      res.status(503).type('text/plain').send(
        'Фронт не собран. В Timeweb Start: cd client && npm run build && cd .. && npm start'
      );
    });
  }
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос. Уменьшите объём данных или обратитесь к администратору.' });
  }
  res.status(500).json({ error: 'Ошибка сервера' });
});

const useHttps = process.env.HTTPS === 'true';
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

function ensureFaceModelsOnDisk() {
  if (faceModelsReady()) return true;
  const script = path.join(__dirname, 'ensure-face-models.mjs');
  if (!fs.existsSync(script)) return false;
  console.log('face-models: восстановление server/public/models...');
  const r = spawnSync(process.execPath, [script], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('face-models: не удалось скопировать веса. Выполните: npm install');
    return false;
  }
  return faceModelsReady();
}

async function initializeDatabaseWithRetry() {
  if (isDatabaseConfigured) {
    let dbReady = false;
    for (let attempt = 1; attempt <= dbStartupRetries; attempt += 1) {
      try {
        await ensureSchema();
        if (isProd) {
          await ensureAdminUser();
        }
        dbReady = true;
        break;
      } catch (err) {
        console.error(
          `Database startup failed (${attempt}/${dbStartupRetries}):`,
          err?.message || err,
        );
        if (attempt < dbStartupRetries) {
          await sleep(dbStartupRetryDelayMs);
        }
      }
    }
    if (!dbReady) {
      console.error(
        'ERROR: инициализация БД не выполнена, но сервер продолжает работать. '
        + 'Проверьте DATABASE_URL/PG* и доступность PostgreSQL.',
      );
    }
  } else {
    console.warn(
      'WARN: параметры БД не заданы (DATABASE_URL или PG*/DB*/POSTGRES*). Запуск без инициализации схемы.',
    );
  }
}

function listenServer() {
  if (useHttps && hasCerts) {
    const server = https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app
    );
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        console.log('HTTPS Server on port', port);
        resolve();
      });
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log('Server on port', port);
      resolve();
    });
    server.once('error', reject);
  });
}

async function startServer() {
  const modelsOk = ensureFaceModelsOnDisk();
  if (!modelsOk) {
    console.warn('WARN: отметка по лицу недоступна — нет server/public/models/*.bin');
  } else {
    console.log('face-models: готовы (server/public/models)');
  }

  await listenServer();

  // Не блокируем startup healthcheck длительной инициализацией БД.
  initializeDatabaseWithRetry().catch((err) => {
    console.error('Database init background task failed:', err?.message || err);
  });
}

startServer().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
