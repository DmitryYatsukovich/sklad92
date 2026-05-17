import pg from 'pg';

const { Pool } = pg;

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const config = { connectionString };

  const sslMode =
    process.env.PGSSLMODE ||
    process.env.DATABASE_SSLMODE ||
    (connectionString?.match(/[?&]sslmode=([^&]+)/i)?.[1] ?? '');

  if (sslMode === 'disable' || process.env.DATABASE_SSL === 'false') {
    config.ssl = false;
    return config;
  }

  const useSsl =
    process.env.DATABASE_SSL === 'true' ||
    ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslMode);

  if (useSsl) {
    // Timeweb/managed PG: verify-full без root.crt в контейнере → self-signed in chain
    config.ssl = {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true',
    };
  }

  return config;
}

const pool = new Pool(buildPoolConfig());

export default pool;
