/**
 * Зависимость: номер карты доступа (card_number) ↔ внутренний номер (internal_uid).
 * Формула: UID = lookup(card_number) — задаётся таблицей card_uid_mapping (не алгебраическая).
 */
import pool from './pool.js';

/**
 * Получить internal_uid по номеру карты.
 * @param {string} cardNumber - номер карты (например 01193315368729728)
 * @returns {Promise<string|null>} internal_uid или null
 */
export async function getUidByCard(cardNumber) {
  if (!cardNumber || typeof cardNumber !== 'string') return null;
  const normalized = String(cardNumber).trim();
  if (!normalized) return null;
  const r = await pool.query(
    'SELECT internal_uid FROM card_uid_mapping WHERE card_number = $1',
    [normalized]
  );
  return r.rows[0]?.internal_uid ?? null;
}

/**
 * Получить номер карты по internal_uid.
 * @param {string} internalUid - внутренний номер (например 09820541)
 * @returns {Promise<string|null>} card_number или null
 */
export async function getCardByUid(internalUid) {
  if (!internalUid || typeof internalUid !== 'string') return null;
  const normalized = String(internalUid).trim();
  if (!normalized) return null;
  const r = await pool.query(
    'SELECT card_number FROM card_uid_mapping WHERE internal_uid = $1',
    [normalized]
  );
  return r.rows[0]?.card_number ?? null;
}

/**
 * Найти пользователя по номеру карты (через UID: card → internal_uid → user.internal_uid).
 * @param {string} cardNumber
 * @returns {Promise<object|null>} user row или null
 */
export async function getUserByCard(cardNumber) {
  const uid = await getUidByCard(cardNumber);
  if (!uid) return null;
  const r = await pool.query(
    `SELECT id, login, display_name, first_name, last_name, internal_uid
     FROM users WHERE internal_uid = $1`,
    [uid]
  );
  return r.rows[0] ?? null;
}
