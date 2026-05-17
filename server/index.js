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
import { loadUser } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;

const app = express();

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

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.HTTPS === 'true',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

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

if (isProd) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

const useHttps = process.env.HTTPS === 'true';
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

if (useHttps && hasCerts) {
  const server = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    app
  );
  server.listen(port, () => {
    console.log('HTTPS Server on port', port);
    console.log('С телефона: https://<IP-компьютера>:' + port);
  });
} else {
  app.listen(port, () => {
    console.log('Server on port', port);
    if (!useHttps && !hasCerts) console.log('HTTPS: npm run generate-certs && HTTPS=true npm run prod:https');
  });
}
