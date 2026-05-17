/**
 * Анализ 51 пары (card, uid) — поиск формулы контроллера.
 */
import fs from 'fs';

const pairs50 = JSON.parse(fs.readFileSync('data/first50-pairs.json', 'utf8'));
const extra = JSON.parse(fs.readFileSync('data/pik-extra-reference.json', 'utf8'));
const pairs = [...pairs50, ...extra.map((p) => ({ ...p, uidNum: parseInt(String(p.uid).replace(/\D/g, ''), 10) || 0 }))];

function test(name, fn) {
  let ok = 0;
  for (const p of pairs) {
    const c = BigInt(p.card);
    const want = p.uidNum;
    let got;
    try {
      got = fn(c);
      if (typeof got === 'number' && got >= 0 && got <= 99999999 && Math.round(got) === want) ok++;
    } catch (_) {}
  }
  if (ok === 51) {
    console.log('FOUND:', name);
    return true;
  }
  return false;
}

console.log('Testing 51 pairs...\n');

// 1) (card >> shift) & mask
for (let sh = 0; sh <= 45; sh++) {
  for (const mask of [0xFFFFFF, 0x7FFFFFF, 0xFFFFFFFF]) {
    if (test(`(card >> ${sh}) & 0x${mask.toString(16)}`, (c) => Number((c >> BigInt(sh)) & BigInt(mask)))) process.exit(0);
  }
}

// 2) (card / 10^k) % 10^8
for (let k = 0; k <= 16; k++) {
  const div = 10n ** BigInt(k);
  if (test(`(card/10^${k})%10^8`, (c) => Number((c / div) % 100000000n))) process.exit(0);
}

// 3) (card % 10^k) для k=7,8,9
for (let k = 7; k <= 9; k++) {
  const mod = 10n ** BigInt(k);
  if (test(`card % 10^${k}`, (c) => Number(c % mod))) process.exit(0);
}

// 4) Комбинация: (card >> sh) % 10^8
for (let sh = 0; sh <= 35; sh++) {
  if (test(`(card >> ${sh}) % 10^8`, (c) => Number((c >> BigInt(sh)) % 100000000n))) process.exit(0);
}

// 5) Первые 8 цифр после 01 как число: (card/10^9) — уже проверено в (card/10^k)%10^8 при k=9

// 6) Payload (без 01): card % 10^15, затем операции
const payload = (c) => c % (10n ** 15n);
for (let sh = 0; sh <= 30; sh++) {
  for (const mask of [0xFFFFFF, 0x7FFFFFF]) {
    if (test(`(payload(card) >> ${sh}) & 0x${mask.toString(16)}`, (c) => Number((payload(c) >> BigInt(sh)) & BigInt(mask)))) process.exit(0);
  }
}

// 7) Может UID = (card mod 10^8) с другой интерпретацией? Или (card div 10^8) mod 10^8 уже при k=8

console.log('No exact formula found.\n');

// Проверка: может UID привязан к порядку в файле, а не к номеру карты?
console.log('Checking if UID correlates with row order...');
const byRow = pairs.map((p, i) => ({ row: i + 1, card: p.card, uid: p.uidNum }));
console.log('Row 51 card', byRow[50].card, 'uid', byRow[50].uid);
console.log('Cards in row order (first 3 and 50,51):', byRow.slice(0, 3).map((r) => r.uid), '...', byRow[49].uid, byRow[50].uid);
