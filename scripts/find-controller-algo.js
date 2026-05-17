/**
 * Поиск алгоритма контроллера: перебор формул card -> uid по 50 эталонным парам.
 */
import fs from 'fs';

const pairs = JSON.parse(fs.readFileSync('data/first50-pairs.json', 'utf8'));
const M = 100000000n;
const M32 = 0x100000000n;

function test(name, fn) {
  let ok = 0;
  for (const p of pairs) {
    const card = BigInt(p.card);
    const want = p.uidNum;
    let got;
    try {
      got = fn(card);
    } catch (e) {
      return 0;
    }
    if (got === want) ok++;
  }
  if (ok === 50) {
    console.log('FOUND:', name);
    return 50;
  }
  return ok;
}

// 1) Побитовое извлечение: (card >> shift) & mask
for (let shift = 0; shift <= 35; shift++) {
  for (const mask of [0xFFFFFFn, 0x7FFFFFFn, 0xFFFFFFFFn, 0x7FFFFFFFn]) {
    const m = mask;
    const ok = test(`(card >> ${shift}) & 0x${m.toString(16)}`, (c) => Number((c >> BigInt(shift)) & m));
    if (ok === 50) process.exit(0);
  }
}

// 2) Card без ведущих "01" (15 цифр)
for (let shift = 0; shift <= 30; shift++) {
  for (const mask of [0xFFFFFFn, 0x7FFFFFFn, 0xFFFFFFFFn]) {
    const ok = test(`(card/100 >> ${shift}) & 0x${mask.toString(16)}`, (c) => {
      const rest = c / 100n; // убираем 01 в конце? нет - 01 в начале
      return Number((rest >> BigInt(shift)) & mask);
    });
    if (ok === 50) process.exit(0);
  }
}

// 3) Остаток от деления: card % 10^k для разных k
for (let k = 7; k <= 9; k++) {
  const mod = 10n ** BigInt(k);
  test(`card % 10^${k}`, (c) => Number(c % mod));
}

// 4) (card / 10^m) % 10^8 для разных m
for (let m = 0; m <= 12; m++) {
  const div = 10n ** BigInt(m);
  const ok = test(`(card / 10^${m}) % 10^8`, (c) => Number((c / div) % M));
  if (ok === 50) process.exit(0);
}

// 5) Комбинация: (card >> shift) % 10^8
for (let shift = 0; shift <= 20; shift++) {
  const ok = test(`(card >> ${shift}) % 10^8`, (c) => Number((c >> BigInt(shift)) % M));
  if (ok === 50) process.exit(0);
}

// 6) Последние 8 цифр как подстрока (уже проверяли - не подходит)
// 7) Первые 8 цифр после 01: (card / 10^7) % 10^8
const ok7 = test('(card/10^7) % 10^8', (c) => Number((c / (10n ** 7n)) % M));
if (ok7 === 50) process.exit(0);

// 8) Средние 8 цифр: (card / 10^4) % 10^8
const ok8 = test('(card/10^4) % 10^8', (c) => Number((c / (10n ** 4n)) % M));
if (ok8 === 50) process.exit(0);

// 9) Конкатенация байт: card как BCD, взять байты 2-5 (индексы 2,3,4,5 из 9 пар цифр)
// 01 19 33 15 36 87 29 72 8 -> байты 19,33,15,36 = 0x19331536 = 421762358? нет
// 10) Младшие 24 бита в десятичном виде
const ok10 = test('card & 0xFFFFFF (decimal)', (c) => Number(c & 0xFFFFFFn));
if (ok10 === 50) process.exit(0);

// 11) Старшие биты: (card >> 24) & 0xFFFFFF
for (let sh = 20; sh <= 35; sh++) {
  const ok = test(`(card >> ${sh}) & 0xFFFFFF`, (c) => Number((c >> BigInt(sh)) & 0xFFFFFFn));
  if (ok === 50) process.exit(0);
}

console.log('No exact formula found. Best partial matches above.');
