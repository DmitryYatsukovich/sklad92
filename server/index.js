import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import express from 'express';

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

import auth from './routes/auth.js';
import users from './routes/users.js';
import materials from './routes/materials.js';
import operations from './routes/operations.js';
import reports from './routes/reports.js';
import roles from './routes/roles.js';
import stats from './routes/stats.js';
import cardUid from './routes/card-uid.js';
import attendance from './routes/attendance.js';
import settings from './routes/settings.js';
import { loadUser } from './middleware/auth.js';
import { ensureAdminUser } from './db/ensure-admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;

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

if (isProd) {
  console.log('NODE_ENV=production, static dir:', clientDist, 'index.html:', hasIndex);
  if (!hasIndex) {
    console.error('FATAL: index.html not found. Run build in Docker/Build step: npm run build');
  }
}

const app = express();
const useSecureCookies = process.env.HTTPS === 'true';

if (isProd) {
  app.set('trust proxy', 1);
}

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
  });
});

app.use(cors({
  origin: isProd ? undefined : true,
  credentials: true,
}));
// Не парсить JSON для multipart (загрузка файлов), иначе тело потребляется и multer падает
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return next();
  express.json()(req, res, next);
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
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};
if (isProd && process.env.DATABASE_URL) {
  sessionOptions.store = new PgSession({
    pool,
    createTableIfMissing: true,
    tableName: 'session',
  });
}
app.use(session(sessionOptions));

app.use(loadUser);

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/materials', materials);
app.use('/api/operations', operations);
app.use('/api/reports', reports);
app.use('/api/roles', roles);
app.use('/api/stats', stats);
app.use('/api/card-uid', cardUid);
app.use('/api/attendance', attendance);
app.use('/api/settings', settings);

if (isProd) {
  if (hasIndex) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
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
  res.status(500).json({ error: 'Ошибка сервера' });
});

const useHttps = process.env.HTTPS === 'true';
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

async function startServer() {
  if (isProd) await ensureAdminUser();

  if (useHttps && hasCerts) {
    const server = https.createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app
    );
    server.listen(port, () => {
      console.log('HTTPS Server on port', port);
    });
  } else {
    app.listen(port, () => {
      console.log('Server on port', port);
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
