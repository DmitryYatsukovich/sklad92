/**
 * Глубокий анализ 51 пары (card, uid) — поиск формулы контроллера.
 */
import fs from 'fs';

const pairs50 = JSON.parse(fs.readFileSync('data/first50-pairs.json', 'utf8'));
const extra = JSON.parse(fs.readFileSync('data/pik-extra-reference.json', 'utf8'));
const pairs = [...pairs50, ...extra.map((p) => ({ card: p.card, uid: p.uid, uidNum: parseInt(String(p.uid).replace(/\D/g, ''), 10) || 0 }))];

function test(name, fn) {
  let ok = 0;
  for (const p of pairs) {
    try {
      const got = fn(p.card, p.uidNum);
      if (got === p.uidNum) ok++;
    } catch (_) {}
  }
  if (ok === 51) {
    console.log('FOUND:', name);
    return true;
  }
  return false;
}

const M = 100000000n;
const M32 = 0x100000000n;

console.log('=== 1. Все варианты (card/10^k)%10^m и (card%10^k)/10^m ===\n');
for (let div = 0; div <= 17; div++) {
  for (let mod = 7; mod <= 9; mod++) {
    test(`(card/10^${div})%10^${mod}`, (card) => Number((BigInt(card) / (10n ** BigInt(div))) % (10n ** BigInt(mod))));
  }
}

console.log('=== 2. Карта как строка — подстроки 7, 8, 9 цифр в разных позициях ===\n');
for (let len = 7; len <= 9; len++) {
  for (let start = 0; start <= 17 - len; start++) {
    test(`card.slice(${start},${start + len})`, (card) => parseInt(card.slice(start, start + len), 10));
  }
}

console.log('=== 3. Payload (без первых 2 цифр) — те же операции ===\n');
for (let div = 0; div <= 12; div++) {
  for (let mod = 7; mod <= 9; mod++) {
    test(`(payload/10^${div})%10^${mod}`, (card) => {
      const p = BigInt(card.slice(2));
      return Number((p / (10n ** BigInt(div))) % (10n ** BigInt(mod)));
    });
  }
}

console.log('=== 4. Битовое извлечение: (card >> s) & mask, mask 24..32 бит ===\n');
for (let sh = 0; sh <= 45; sh++) {
  for (const bits of [24, 26, 27, 28, 32]) {
    const mask = (1n << BigInt(bits)) - 1n;
    if (test(`(card>>${sh})&${bits}bit`, (card) => Number((BigInt(card) >> BigInt(sh)) & mask))) process.exit(0);
  }
}

console.log('=== 5. Карта в hex (15 цифр после 01) — битовое извлечение ===\n');
for (let sh = 0; sh <= 35; sh++) {
  for (const bits of [24, 27]) {
    const mask = (1n << BigInt(bits)) - 1n;
    test(`(payload_hex>>${sh})&${bits}bit`, (card) => {
      const payload = BigInt(card.slice(2));
      return Number((payload >> BigInt(sh)) & mask);
    });
  }
}

console.log('=== 6. Комбинация: (card%10^a)/10^b даёт 8 цифр ===\n');
for (let a = 8; a <= 12; a++) {
  for (let b = 0; b <= 4; b++) {
    if (a - b >= 7 && a - b <= 9)
      test(`(card%10^${a})/10^${b}`, (card) => Number((BigInt(card) % (10n ** BigInt(a))) / (10n ** BigInt(b))));
  }
}

console.log('=== 7. Два поля: facility (2 цифры) * 10^6 + card (6 цифр) из карты ===\n');
for (let facStart = 2; facStart <= 6; facStart++) {
  for (let facLen of [1, 2]) {
    for (let cardStart = 2; cardStart <= 10; cardStart++) {
      if (cardStart === facStart) continue;
      const cardLen = 6;
      test(`fac=${facStart}:${facStart + facLen} card=${cardStart}:${cardStart + cardLen}`, (card) => {
        const fac = parseInt(card.slice(facStart, facStart + facLen), 10);
        const cardPart = parseInt(card.slice(cardStart, cardStart + cardLen), 10);
        if (fac > 99 || cardPart > 999999) return -1;
        return fac * 1000000 + cardPart;
      });
    }
  }
}

console.log('=== 8. Линейная (a*card+b) mod 10^8 — перебор малых a, b ===\n');
for (let a = 1; a <= 999; a++) {
  for (let b = 0; b <= 99999999; b += 1000000) {
    let ok = 0;
    for (const p of pairs) {
      const c = BigInt(p.card);
      const v = Number((c * BigInt(a) + BigInt(b)) % M);
      if (v === p.uidNum) ok++;
    }
    if (ok === 51) {
      console.log('FOUND: (', a, '*card +', b, ') % 10^8');
      process.exit(0);
    }
  }
  if (a % 100 === 0) process.stdout.write('.');
}

console.log('\n=== 9. Обратные биты (reversed bit order) — последние 24 бита как decimal ===\n');
function bitReverse24(n) {
  let x = Number(n & 0xffffffn);
  let r = 0;
  for (let i = 0; i < 24; i++) {
    r = (r << 1) | (x & 1);
    x >>= 1;
  }
  return r;
}
for (let sh = 0; sh <= 30; sh++) {
  let ok = 0;
  for (const p of pairs) {
    const c = BigInt(p.card);
    const v = (c >> BigInt(sh)) & 0xffffffn;
    const rev = bitReverse24(v);
    if (rev <= 99999999 && rev === p.uidNum) ok++;
  }
  if (ok === 51) {
    console.log('FOUND: bitReverse24((card >>', sh, ') & 0xFFFFFF)');
    process.exit(0);
  }
}

console.log('\n=== 10. Байты BCD: карта по 2 цифры = байты, взять 4 байта как число ===\n');
for (let byteStart = 0; byteStart <= 5; byteStart++) {
  test(`BCD bytes ${byteStart}-${byteStart + 4}`, (card) => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const pos = (byteStart + i) * 2;
      v = v * 100 + parseInt(card.slice(pos, pos + 2), 10);
    }
    return v <= 99999999 ? v : -1;
  });
}

console.log('\n=== 11. (card XOR key) mod 10^8 для постоянного key ===\n');
const c0 = BigInt(pairs[0].card);
const u0 = pairs[0].uidNum;
const key = Number(c0 % M) ^ u0;
let ok = 0;
for (const p of pairs) {
  const v = Number(BigInt(p.card) % M) ^ key;
  if (v >= 0 && v <= 99999999 && v === p.uidNum) ok++;
}
if (ok === 51) console.log('FOUND: (card % 10^8) XOR', key);

console.log('\n=== 12. Разность card - uid (последние 8 цифр разности?) ===\n');
for (const p of pairs.slice(0, 3)) {
  const c = BigInt(p.card);
  const d = c - BigInt(p.uidNum);
  console.log('  card', p.card, 'uid', p.uidNum, 'diff', d.toString(), 'diff%10^8', Number(d % M));
}

console.log('\n=== 13. Проверка: UID = последние 8 цифр (card * K) для малых K ===\n');
for (let K = 1; K <= 99; K++) {
  let ok = 0;
  for (const p of pairs) {
    const v = Number((BigInt(p.card) * BigInt(K)) % M);
    if (v === p.uidNum) ok++;
  }
  if (ok === 51) {
    console.log('FOUND: (card *', K, ') % 10^8');
    process.exit(0);
  }
}

console.log('\nАнализ завершён. Точно совпадающей формулы не найдено.');
