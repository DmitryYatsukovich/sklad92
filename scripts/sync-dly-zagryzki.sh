#!/bin/sh
# Синхронизация папки для загрузки на GitHub (< 100 файлов, без лишнего)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/dly zagryzki"

rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude 'client/node_modules/' \
  --exclude 'client/dist/' \
  --exclude 'server/public/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'server/uploads/' \
  --exclude 'server/certs/' \
  --exclude 'dly zagryzki/' \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude 'data/' \
  --exclude 'docs/' \
  --exclude 'DEPLOY_RAILWAY.md' \
  --exclude 'HTTPS-ИНСТРУКЦИЯ.md' \
  --exclude 'scripts/add-xlsx-header.js' \
  --exclude 'scripts/deep-analyze-uid.js' \
  --exclude 'scripts/fill-xlsx-uids.js' \
  --exclude 'scripts/analyze-controller-51.js' \
  --exclude 'scripts/find-controller-algo.js' \
  --exclude 'scripts/fill-excel-column-c.mjs' \
  --exclude 'scripts/dev-https.mjs' \
  --exclude 'server/db/seed-card-uid.js' \
  --exclude 'server/db/fill-missing-uids.js' \
  --exclude 'server/db/seed-random-users.js' \
  "$ROOT/" "$DEST/"

# rsync --exclude не удаляет старые папки на приёмнике — чистим вручную
rm -rf "$DEST/data" "$DEST/docs" 2>/dev/null || true
rm -f "$DEST/DEPLOY_RAILWAY.md" "$DEST/HTTPS-ИНСТРУКЦИЯ.md" 2>/dev/null || true
for f in add-xlsx-header.js deep-analyze-uid.js fill-xlsx-uids.js analyze-controller-51.js find-controller-algo.js fill-excel-column-c.mjs dev-https.mjs; do
  rm -f "$DEST/scripts/$f"
done
rm -f "$DEST/server/db/seed-card-uid.js" "$DEST/server/db/fill-missing-uids.js" "$DEST/server/db/seed-random-users.js"
find "$DEST" -name '.DS_Store' -delete 2>/dev/null || true

COUNT=$(find "$DEST" -type f | wc -l | tr -d ' ')
echo "Готово: $DEST ($COUNT файлов, лимит GitHub через сайт — 100)"
