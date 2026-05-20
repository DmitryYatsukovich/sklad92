# Загрузка на Timeweb

## Полный пакет (без лимита по числу файлов)

Одна папка **`timeweb-upload/`** в корне репозитория + один архив для загрузки:

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

Загрузите **всё содержимое** папки `timeweb-upload` (или распакованный `warehouse-timeweb-full.zip`) в корень приложения на Timeweb (Node.js).

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

Обязательно **`npm start`** (не `node server/index.js` напрямую): при старте подтягиваются модели распознавания лиц.

### Отметка по лицу (модели ~13 МБ)

В `package.json` есть зависимость `@vladmandic/face-api`. После **`npm install`** скрипт копирует веса в **`server/public/models/`** (файлы `.bin`).

Проверка после деплоя:

1. Откройте `https://ваш-домен/api/health` — должно быть `"hasFaceModels": true`.
2. Откройте `https://ваш-домен/models/face_recognition_model.bin` — должен скачиваться файл ~6 МБ, **не** HTML-страница.

Если `hasFaceModels: false` — на сервере снова `npm install && npm start`. При сборке пакета локально используйте **`npm run timeweb:bundle`** (в архив уже входят `server/public/models`).

## HTTPS

Для QR и камеры на телефоне включите SSL для домена в панели Timeweb.

## Обновление

1. Локально: `npm run prepare:timeweb`
2. Загрузите файлы на сервер (сохраните `.env` и `server/uploads/`)
3. `npm install` при изменении `package.json`
4. Перезапуск приложения
