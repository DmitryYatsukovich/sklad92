import pg from 'pg';

const { Pool } = pg;

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

const rawUrl = pickEnv('DATABASE_URL', 'POSTGRES_URL', 'DB_URL');
const host = pickEnv('PGHOST', 'POSTGRES_HOST', 'DATABASE_HOST', 'DB_HOST');
const portRaw = pickEnv('PGPORT', 'POSTGRES_PORT', 'DATABASE_PORT', 'DB_PORT');
const user = pickEnv('PGUSER', 'POSTGRES_USER', 'DATABASE_USER', 'DB_USER');
const password = pickEnv('PGPASSWORD', 'POSTGRES_PASSWORD', 'DATABASE_PASSWORD', 'DB_PASSWORD');
const database = pickEnv('PGDATABASE', 'POSTGRES_DB', 'DATABASE_NAME', 'DB_NAME');

/** Убираем sslmode из URL — иначе pg переопределяет ssl и включает строгую проверку сертификата */
function connectionStringWithoutSslParams(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('sslrootcert');
    parsed.searchParams.delete('sslcert');
    parsed.searchParams.delete('sslkey');
    const s = parsed.toString();
    return s.endsWith('?') ? s.slice(0, -1) : s;
  } catch {
    return url
      .replace(/[?&]sslmode=[^&]*/gi, '')
      .replace(/[?&]sslrootcert=[^&]*/gi, '')
      .replace(/\?&/, '?')
      .replace(/\?$/, '');
  }
}

const connectionString = connectionStringWithoutSslParams(rawUrl);
const sslMode = (
  process.env.PGSSLMODE ||
  process.env.DATABASE_SSLMODE ||
  process.env.DB_SSLMODE ||
  rawUrl.match(/[?&]sslmode=([^&]+)/i)?.[1] ||
  ''
).toLowerCase();

const numericPort = Number.parseInt(portRaw, 10);
const hasUrlConfig = Boolean(connectionString);
const hasDiscreteConfig = Boolean(host || user || password || database || portRaw);

const isLocalHost = typeof host === 'string'
  && /^(localhost|127\.0\.0\.1)$/i.test(host);
const isLocal = isLocalHost || /@(localhost|127\.0\.0\.1)(:|\/)/i.test(rawUrl);

/** @type {import('pg').PoolConfig} */
const poolConfig = {};

if (hasUrlConfig) {
  poolConfig.connectionString = connectionString;
} else if (hasDiscreteConfig) {
  if (host) poolConfig.host = host;
  if (Number.isFinite(numericPort)) poolConfig.port = numericPort;
  if (user) poolConfig.user = user;
  if (password) poolConfig.password = password;
  if (database) poolConfig.database = database;
}

if (sslMode === 'disable' || process.env.DATABASE_SSL === 'false') {
  poolConfig.ssl = false;
} else if (!isLocal) {
  // Timeweb Cloud и другие managed PG: SSL без проверки цепочки (нет root.crt в контейнере)
  poolConfig.ssl = { rejectUnauthorized: false };
}

export const isDatabaseConfigured = hasUrlConfig || hasDiscreteConfig;
export const databaseConfigSource = hasUrlConfig
  ? 'DATABASE_URL'
  : (hasDiscreteConfig ? 'discrete-env' : 'default');

const pool = new Pool(poolConfig);

export default pool;
