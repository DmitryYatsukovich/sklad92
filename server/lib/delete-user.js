import pool from '../db/pool.js';

/** Удаление пользователя и связанных данных (выдачи, посещения, права). */
export async function deleteUserById(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = (await client.query('SELECT id FROM users WHERE id = $1', [userId])).rows[0];
    if (!u) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      'DELETE FROM issuances WHERE issued_by_user_id = $1 OR issued_to_user_id = $1',
      [userId],
    );

    const del = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    if (del.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');

    return del.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
