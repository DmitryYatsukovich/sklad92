import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || '';
const sslMode = (
  process.env.PGSSLMODE ||
  process.env.DATABASE_SSLMODE ||
  connectionString.match(/[?&]sslmode=([^&]+)/i)?.[1] ||
  ''
).toLowerCase();

/** @type {import('pg').PoolConfig} */
const poolConfig = { connectionString };

// Локально (docker): без sslmode или sslmode=disable
if (sslMode === 'disable' || process.env.DATABASE_SSL === 'false') {
  poolConfig.ssl = false;
} else if (
  sslMode === 'require' ||
  sslMode === 'verify-full' ||
  sslMode === 'verify-ca' ||
  sslMode === 'prefer' ||
  process.env.DATABASE_SSL === 'true' ||
  connectionString.includes('twc1.net')
) {
  // Timeweb Cloud: шифрование без проверки цепочки (нет root.crt в контейнере)
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

export default pool;
