import pg from 'pg';

const { Pool } = pg;

const rawUrl = process.env.DATABASE_URL || '';

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
  rawUrl.match(/[?&]sslmode=([^&]+)/i)?.[1] ||
  ''
).toLowerCase();

const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/i.test(rawUrl);

/** @type {import('pg').PoolConfig} */
const poolConfig = { connectionString };

if (sslMode === 'disable' || process.env.DATABASE_SSL === 'false') {
  poolConfig.ssl = false;
} else if (!isLocal) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

export default pool;
