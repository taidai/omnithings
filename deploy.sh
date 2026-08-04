#!/bin/bash
# ============================================================
# ZiZu CI/CD 部署脚本
#
# 用法:
#   bash deploy.sh [version]          # 默认 version=0.1.0
#   bash deploy.sh 0.1.0             # 指定版本号
#   bash deploy.sh --local           # 仅本地构建, 不部署
#   bash deploy.sh --push            # 构建并推送到服务器
#   bash deploy.sh --init-db         # 仅初始化数据库(首次)
#
# 流程: 本地 buildx arm64 镜像 → save tar → scp 到 e606 → load → 重启容器
# ============================================================

set -euo pipefail

# ---- 配置 ----
VERSION="${1:-0.1.0}"
IMAGE_NAME="zizu"
IMAGE_TAG="${IMAGE_NAME}:${VERSION}-arm"
TAR_FILE="${IMAGE_NAME}-${VERSION}-arm.tar.gz"

SSH_HOST="root@e606.hlszh.com"
SSH_PORT="13122"
SSH_KEY="$HOME/.ssh/id_omnopower_deploy_nopass"
REMOTE_DIR="/home/zizu"
CONTAINER_NAME="zizu"
APP_PORT="9000"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[DEPLOY]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_err()   { echo -e "${RED}[✗]${NC} $*"; }

# ============================================================
# Step 1: 构建 ARM64 Docker 镜像 (本地 cross-compile)
# ============================================================
build_image() {
    log_info "Building ${IMAGE_TAG} for linux/arm64 ..."
    
    # 检查 buildx 是否支持 arm64
    if ! docker buildx inspect | grep -q "linux/arm64" 2>/dev/null; then
        log_warn "buildx 不支持 arm64, 尝试创建 builder ..."
        docker buildx create --name arm-builder --use --driver docker-container 2>/dev/null || true
        docker buildx inspect --bootstrap 2>/dev/null || true
    fi

    # Multi-platform build (ARM64 only for deployment)
    # context = project root so backend/Dockerfile can COPY frontend/ and backend/app/
    docker buildx build \
        --platform linux/arm64 \
        -t "${IMAGE_TAG}" \
        -t "${IMAGE_NAME}:latest-arm" \
        -f backend/Dockerfile \
        . \
        --load
    
    log_ok "Image built: ${IMAGE_TAG}"
    docker images "${IMAGE_TAG}" --format "{{.Size}}"
}

# ============================================================
# Step 2: 导出为 tar 文件
# ============================================================
export_tar() {
    log_info "Exporting image to ${TAR_FILE} ..."
    docker save "${IMAGE_TAG}" | gzip > "${TAR_FILE}"
    local size=$(du -h "${TAR_FILE}" | cut -f1)
    log_ok "Exported: ${TAR_FILE} (${size})"
}

# ============================================================
# Step 3: SCP 传输到服务器
# ============================================================
push_to_server() {
    log_info "Pushing to ${SSH_HOST} ..."
    
    # SSH 测试连接
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" -o StrictHostKeyChecking=no \
        "${SSH_HOST}" "echo 'SSH OK' && hostname && uname -m"
    
    # 创建远程目录
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" "${SSH_HOST}" \
        "mkdir -p ${REMOTE_DIR}/app ${REMOTE_DIR}/init-db"
    
    # 传输镜像 tar
    scp -i "${SSH_KEY}" -P "${SSH_PORT}" \
        "${TAR_FILE}" \
        "${SSH_HOST}:/tmp/${TAR_FILE}"
    
    # 传输应用代码 (tar+ssh 管道，排除缓存文件)
    tar czf - \
        --exclude='.venv' \
        --exclude='__pycache__' \
        --exclude='.web' \
        --exclude='*.pyc' \
        --exclude='.git' \
        --exclude='.workbuddy' \
        backend/app/ backend/pyproject.toml init-db/ .env.e606 docker-compose.yml docker-compose.e606.yml | \
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" \
        "${SSH_HOST}" "cd ${REMOTE_DIR} && tar xzf -"
    
    # 复制环境变量模板
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" "${SSH_HOST}" \
        "test -f ${REMOTE_DIR}/.env || cp ${REMOTE_DIR}/.env.e606 ${REMOTE_DIR}/.env"
    
    log_ok "Files pushed to ${REMOTE_DIR}"
}

# ============================================================
# Step 4: 服务器端加载 + 启动
# ============================================================
deploy_on_server() {
    log_info "Deploying on server ..."
    
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" "${SSH_HOST}" bash -s << 'DEPLOY_SCRIPT'
set -euo pipefail

REMOTE_DIR="/home/zizu"
TAR_FILE="$(ls /tmp/zizu-*-arm.tar.gz 2>/dev/null | head -1)"
IMAGE_TAG=$(basename "$TAR_FILE" .tar.gz)

echo "[SERVER] Loading Docker image from $TAR_FILE ..."
docker load < "$TAR_FILE"
echo "[SERVER] Image loaded:"
docker images | grep zizu

echo "[SERVER] Stopping old container (if running)..."
docker stop zizu 2>/dev/null || true
docker rm zizu 2>/dev/null || true

echo "[SERVER] Starting new container..."
cd "$REMOTE_DIR"
# e606 内核裁剪版: 必须叠加 e606 override (host 网络 + tmpfs /dev/mqueue), 且不现场 build
docker compose -f docker-compose.yml -f docker-compose.e606.yml up -d --no-build backend

echo "[SERVER] Waiting for health check..."
sleep 5

echo "[SERVER] Container status:"
docker ps | grep zizu

echo "[SERVER] Health check:"
curl -sf "http://127.0.0.1:9000/api/v1/health" | python3 -m json.tool 2>/dev/null || \
    echo "[SERVER] Waiting more..." && sleep 5 && curl -sf "http://127.0.0.1:9000/api/v1/health" || \
    echo "[WARN] Health check not yet ready (check logs with: docker logs zizu)"

echo "[SERVER] Recent logs:"
docker logs zizu 2>&1 | tail -20

DEPLOY_SCRIPT

    log_ok "Deployed! Access: http://e606.hlszh.com:${APP_PORT}/api/v1/health"
    log_info "View logs: ssh ... \"docker logs -f zizu\""
}

# ============================================================
# Step 5: 仅初始化数据库 (首次部署)
# ============================================================
init_db() {
    log_info "Initializing database on e606 ..."
    
    ssh -i "${SSH_KEY}" -p "${SSH_PORT}" "${SSH_HOST}" bash -s << 'INIT_SCRIPT'
set -euo pipefail

DB_USER="zizu"
DB_PASS="zizu_dev_2026"
DB_NAME="zizu"

echo "[DB] Creating database and user ..."
sudo -u postgres psql <<SQL
-- 用户已存在则忽略
DO \$\$
BEGIN
    CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'User already exists';
END
$$;

CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
\c ${DB_NAME}
CREATE EXTENSION IF NOT EXISTS timescaledb;
SQL

echo "[DB] Importing schema ..."
sudo -u postgres psql -d ${DB_NAME} < /home/zizu/init-db/001-schema.sql

echo "[DB] Verifying tables ..."
sudo -u postgres psql -d ${DB_NAME} -c "\dt"
sudo -u postgres psql -d ${DB_NAME} -c "SELECT extname FROM pg_extension WHERE extname='timescaledb';"

INIT_SCRIPT

    log_ok "Database initialized: zizu"
}

# ============================================================
# Main
# ============================================================
main() {
    echo ""
    echo "========================================="
    echo "  ZiZu CI/CD Deploy v${VERSION}"
    echo "  Target: ${SSH_HOST}"
    echo "========================================="
    echo ""

    case "${1:-}" in
        --local)
            build_image
            export_tar
            log_ok "Local build complete. Tar: ${TAR_FILE}"
            ;;
        --init-db)
            init_db
            ;;
        --push)
            push_to_server
            deploy_on_server
            ;;
        *)
            # Full pipeline: build → export → push → deploy
            build_image
            export_tar
            push_to_server
            deploy_on_server
            
            # 清理本地 tar
            rm -f "${TAR_FILE}"
            
            echo ""
            log_ok "========== DEPLOY COMPLETE =========="
            echo ""
            echo "  API:     http://e606.hlszh.com:${APP_PORT}/api/docs"
            echo "  Health:  http://e606.hlszh.com:${APP_PORT}/api/v1/health"
            echo "  Logs:    ssh -i ${SSH_KEY} -p ${SSH_PORT} ${SSH_HOST} \"docker logs -f zizu\""
            echo ""
            ;;
    esac
}

main "$@"
