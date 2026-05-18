# Загрузка на Timeweb

Сборка в папку `dly zagryzki`:

```bash
npm run prepare:timeweb:full
npm run zip:timeweb:full   # опционально: warehouse-timeweb-full.zip
```

Урезанный пакет (≤100 файлов): `npm run prepare:timeweb`

## Что загружать

Загрузите **всё содержимое** папки `dly zagryzki` в корень приложения на Timeweb (Node.js).

Не загружайте `node_modules` — на сервере выполните `npm install`.

В комплекте уже есть собранный фронтенд в `server/public/` (повторная сборка на сервере не обязательна).

Пакет урезан под **лимит 100 файлов**: без папки `client/` (исходники), без ручных `migrate-*.js` (схема обновляется через `ensure-schema.js` при старте).

## Переменные окружения

Скопируйте `.env.example` в `.env`:

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL` | PostgreSQL Timeweb Cloud |
| `SESSION_SECRET` | Случайная длинная строка |
| `PORT` | Порт (часто задаёт панель) |
| `NODE_ENV` | `production` |

Миграции БД выполняются при старте (`ensureSchema`).

## Запуск

```bash
npm install
npm start
```

## HTTPS

Для QR и камеры на телефоне включите SSL для домена в панели Timeweb.

## Обновление

1. Локально: `npm run prepare:timeweb`
2. Загрузите файлы на сервер (сохраните `.env` и `server/uploads/`)
3. `npm install` при изменении `package.json`
4. Перезапуск приложения
