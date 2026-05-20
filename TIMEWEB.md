# Загрузка на Timeweb

## Полный пакет (без лимита по числу файлов)

Одна папка **`timeweb-bundle/`** в корне репозитория + один архив для загрузки:

```bash
npm run timeweb:bundle
```

В корне появится **`warehouse-timeweb-full.zip`** — можно залить **одним файлом** в панель Timeweb и распаковать в каталог приложения.

Только папка (без zip):

```bash
npm run prepare:timeweb:full
```

Урезанный пакет (≤100 файлов, старая схема): `npm run prepare:timeweb` → папка `dly zagryzki/`, `npm run zip:timeweb`.

## Что загружать

Загрузите **всё содержимое** папки `timeweb-bundle` (или распакованный zip) в корень приложения на Timeweb (Node.js).

Не загружайте `node_modules` — на сервере выполните `npm install`.

В комплекте уже есть собранный фронтенд в `server/public/` (повторная сборка на сервере не обязательна).

Пакет `prepare:timeweb` урезан под **лимит 100 файлов**: без папки `client/` (исходники), без части `migrate-*.js` (схема обновляется через `ensure-schema.js` при старте).

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
