#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
BASE=/home/zizu
BAK=$BASE/bak
mkdir -p $BAK
cp -a $BASE/backend/app $BAK/backend-app-$TS
cp -a $BASE/frontend/dist $BAK/frontend-dist-$TS
cp $BASE/VERSION $BAK/VERSION-$TS
echo "[deploy] backup done: $TS"
unzip -o /tmp/zizu-v0.4.24-update.zip -d $BASE
echo "[deploy] code extracted"
cp $BASE/VERSION $BASE/backend/app/VERSION
cd $BASE
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --force-recreate backend
echo "[deploy] waiting..."
sleep 15
docker compose -f docker-compose.yml -f docker-compose.host.yml ps backend
curl -sf http://127.0.0.1:9000/api/v1/health || true
echo "[deploy] done"
