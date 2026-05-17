import 'dotenv/config';
import pool from './pool.js';
import bcrypt from 'bcryptjs';

const NAMES = [
  'Александр', 'Дмитрий', 'Максим', 'Иван', 'Артём', 'Михаил', 'Никита', 'Егор', 'Даниил', 'Андрей',
  'Сергей', 'Алексей', 'Павел', 'Роман', 'Владимир', 'Денис', 'Евгений', 'Николай', 'Игорь', 'Олег',
  'Мария', 'Анна', 'Елена', 'Ольга', 'Наталья', 'Татьяна', 'Ирина', 'Светлана', 'Екатерина', 'Юлия',
  'Виктория', 'Полина', 'Алина', 'Дарья', 'Кристина', 'Валерия', 'Анастасия', 'Ксения', 'София', 'Вероника',
];

const SURNAMES = [
  'Иванов', 'Петров', 'Сидоров', 'Козлов', 'Смирнов', 'Новиков', 'Морозов', 'Волков', 'Соколов', 'Лебедев',
  'Кузнецов', 'Попов', 'Васильев', 'Михайлов', 'Федоров', 'Андреев', 'Алексеев', 'Николаев', 'Егоров', 'Павлов',
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBool() {
  return Math.random() > 0.3;
}

async function run() {
  const defaultPassword = process.env.USER_PASSWORD || 'user';
  const hash = await bcrypt.hash(defaultPassword, 10);
  const client = await pool.connect();

  try {
    for (let i = 1; i <= 100; i++) {
      const login = `user_${i}`;
      const displayName = `${randomItem(NAMES)} ${randomItem(SURNAMES)}`;
      const canWarehouse = randomBool();
      const canIssuance = randomBool();
      const canProduction = randomBool();
      const canUsers = Math.random() > 0.9;

      await client.query(
        `INSERT INTO users (login, password_hash, display_name, role)
         VALUES ($1, $2, $3, 'user')
         ON CONFLICT (login) DO NOTHING`,
        [login, hash, displayName]
      );

      const { rows: [u] } = await client.query('SELECT id FROM users WHERE login = $1', [login]);
      if (u) {
        await client.query(
          `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             can_warehouse = $2, can_issuance = $3, can_production = $4, can_users = $5`,
          [u.id, canWarehouse, canIssuance, canProduction, canUsers]
        );
      }
    }
    console.log('Added 100 random users. Password for all: ' + defaultPassword);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
