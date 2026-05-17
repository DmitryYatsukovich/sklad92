# Деплой на Railway

Пошаговая инструкция, чтобы выложить приложение на Railway и пользоваться им с любого устройства по ссылке.

## 1. Репозиторий на GitHub

Если проекта ещё нет в Git:

```bash
git init
git add .
git commit -m "Initial commit"
```

Создайте репозиторий на [github.com](https://github.com/new) и выполните:

```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/warehouse-app.git
git branch -M main
git push -u origin main
```

**Важно:** в корне должен быть `.gitignore`, чтобы не попадали в репозиторий:

- `node_modules/`
- `client/node_modules/`
- `.env`
- `client/dist/`
- `server/uploads/`
- `server/certs/`

## 2. Аккаунт и проект в Railway

1. Зайдите на [railway.app](https://railway.app) и войдите через GitHub.
2. **New Project** → **Deploy from GitHub repo**.
3. Выберите репозиторий `warehouse-app` (при необходимости дайте Railway доступ к нему).
4. Railway создаст сервис и начнёт первый деплой — он может упасть, пока не добавлена БД и переменные.

## 3. База данных PostgreSQL

1. В проекте Railway нажмите **+ New** → **Database** → **PostgreSQL**.
2. Дождитесь создания БД. В настройках базы появится переменная **`DATABASE_URL`**.
3. Перейдите в ваш **сервис приложения** (не БД) → вкладка **Variables**.
4. Нажмите **+ New Variable** → **Add variable from another service** и выберите **PostgreSQL** → **DATABASE_URL**.  
   Так в приложение подставится корректная строка подключения.

## 4. Переменные окружения

В том же разделе **Variables** сервиса приложения добавьте:

| Переменная       | Значение | Обязательно |
|------------------|----------|-------------|
| `DATABASE_URL`   | (подтягивается из PostgreSQL, см. выше) | да |
| `SESSION_SECRET` | Любая длинная случайная строка (например, сгенерируйте на [randomkeygen.com](https://randomkeygen.com)) | да |
| `NODE_ENV`       | `production` | да (обычно Railway ставит сам) |

`PORT` Railway задаёт сам, указывать не нужно.

## 5. Сборка и старт

В проекте уже настроены скрипты:

- **Build:** `npm run build` — ставит зависимости в `client` и собирает фронтенд.
- **Start:** `npm start` — запускает `node server/index.js`.

В Railway → ваш сервис → **Settings** проверьте:

- **Build Command:** можно оставить пустым (будет использоваться `npm run build` из `package.json`).
- **Start Command:** можно оставить пустым (будет использоваться `npm start`).
- **Root Directory:** пусто (корень репозитория).

Сохраните и сделайте **Redeploy** (вкладка Deployments → три точки у последнего деплоя → Redeploy).

## 6. Миграции и сиды (первый запуск)

После первого успешного деплоя БД пустая. Миграции и сиды нужно выполнить один раз.

**Вариант А — через Railway CLI**

1. Установите CLI: [docs.railway.app/develop/cli](https://docs.railway.app/develop/cli).
2. В каталоге проекта:
   ```bash
   railway link   # выберите проект и сервис
   railway run npm run db:migrate
   railway run npm run db:seed
   ```

**Вариант Б — одноразовый скрипт в коде**

Можно временно в `server/index.js` после подключения к БД вызвать миграции (не забудьте убрать после первого деплоя).

После выполнения миграций и сида можно входить под пользователем из сида (например, `admin` / `admin`, если не меняли в сидах).

## 7. Ссылка на приложение

1. В сервисе приложения откройте **Settings** → **Networking** → **Generate Domain**.
2. Railway выдаст домен вида `ваш-сервис.up.railway.app`.
3. Откройте эту ссылку в браузере — должно открыться ваше приложение. Им можно пользоваться с любого устройства и из любой сети.

При необходимости позже можно подключить свой домен в том же разделе **Networking**.

---

## Загрузка аватаров

Сейчас аватары сохраняются в папку `server/uploads/avatars`. На Railway диск эфемерный: при перезапуске/редиплое файлы пропадут. Для продакшена лучше позже вынести загрузки в хранилище (например, Railway Volume или S3) и править код отдачи/сохранения файлов. Для начала деплоя текущий вариант допустим.

## Полезные ссылки

- [Документация Railway](https://docs.railway.app)
- [Переменные и секреты](https://docs.railway.app/develop/variables)
- [Railway CLI](https://docs.railway.app/develop/cli)
