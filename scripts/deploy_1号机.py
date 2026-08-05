#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy ZiZu v0.4.35 to 1号机 (e606.hlszh.com:13122).
Strategy: build frontend dist locally, tar code, SFTP upload, sudo extract,
apply migrations 011-014, recreate backend container.
"""
import os
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import paramiko

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSION = (REPO_ROOT / "VERSION").read_text().strip()

HOST = "e606.hlszh.com"
PORT = 13122
USER = "holo"
PASSWD = "holo123"
REMOTE_DIR = "/home/omnithings"
CONTAINER = "omnithings"
TSDB_CONTAINER = "omnithings-tsdb"
DB_USER = "omnithings"
DB_NAME = "omnithings"
DB_PASS = "omnidev_2026"

SUDO_PROMPT = "holo123"

PATHS_TO_SYNC = [
    "backend/app",
    "frontend/dist",
    "VERSION",
    "init-db",
]

NEW_MIGRATIONS = [
    "migration_011_entities.sql",
    "migration_012_standard_entities.sql",
    "migration_013_drop_snapshots.sql",
    "migration_014_alarm_level_fault_map.sql",
]


def log(msg):
    print(f"[DEPLOY] {msg}", flush=True)


def build_frontend():
    log("Building frontend dist ...")
    cwd = REPO_ROOT / "frontend"
    code = os.system(f"cd /d {cwd} && npm run build")
    if code != 0:
        raise RuntimeError("frontend build failed")
    log("Frontend build OK")


def make_tarball():
    fd, tar_path = tempfile.mkstemp(suffix=".tar.gz", prefix="zizu-deploy-")
    os.close(fd)
    log(f"Packing deployment tarball: {tar_path}")
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in PATHS_TO_SYNC:
            src = REPO_ROOT / rel
            if not src.exists():
                raise FileNotFoundError(src)
            tar.add(src, arcname=rel)
    size = os.path.getsize(tar_path)
    log(f"Tarball size: {size / 1024 / 1024:.2f} MB")
    return tar_path


def sudo_exec(client, command, timeout=120):
    full = f"echo '{SUDO_PROMPT}' | sudo -S bash -c {command!r}"
    stdin, stdout, stderr = client.exec_command(full, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def upload_and_extract(tar_path):
    log("Connecting to 1号机 ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWD,
                   timeout=20, banner_timeout=40, auth_timeout=40)
    log("SSH connected")

    remote_tar = f"/tmp/zizu-deploy-{VERSION}.tar.gz"
    sftp = client.open_sftp()
    log(f"Uploading {tar_path} -> {remote_tar}")
    sftp.put(tar_path, remote_tar)
    sftp.close()
    log("Upload complete")

    log(f"Extracting to {REMOTE_DIR} ...")
    rc, out, err = sudo_exec(client,
        f"cd {REMOTE_DIR} && rm -rf backend/app frontend/dist VERSION init-db && "
        f"tar -xzf {remote_tar} -C {REMOTE_DIR} && "
        f"rm -rf {REMOTE_DIR}/backend/app/__pycache__ && "
        f"find {REMOTE_DIR}/backend/app -type d -name __pycache__ -exec rm -rf {{}} + 2>/dev/null; "
        f"echo {VERSION!r} > {REMOTE_DIR}/VERSION"
    )
    if rc != 0:
        log(f"Extract failed: {err}")
        raise RuntimeError("extract failed")
    log("Extract OK")
    log(out)

    return client


def apply_migrations(client):
    log("Applying DB migrations 011-014 ...")
    for migration in NEW_MIGRATIONS:
        local_path = REPO_ROOT / "init-db" / migration
        sql = local_path.read_text(encoding="utf-8")
        cmd = (
            f"docker exec -i -e PGPASSWORD={DB_PASS} {TSDB_CONTAINER} "
            f"psql -U {DB_USER} -d {DB_NAME} -v ON_ERROR_STOP=1"
        )
        full = f"echo '{SUDO_PROMPT}' | sudo -S bash -c {cmd!r}"
        stdin, stdout, stderr = client.exec_command(full, timeout=120)
        stdin.write(sql)
        stdin.channel.shutdown_write()
        rc = stdout.channel.recv_exit_status()
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        log(f"Migration {migration}: rc={rc}")
        if rc != 0:
            log(f"Migration output: {out}\nError: {err}")
            raise RuntimeError(f"migration {migration} failed")
    log("Migrations OK")


def recreate_backend(client):
    log("Recreating backend container ...")
    rc, out, err = sudo_exec(client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.yml -f docker-compose.e606.yml "
        f"up -d --no-build --force-recreate backend",
        timeout=180
    )
    if rc != 0:
        log(f"Recreate failed: {err}")
        raise RuntimeError("recreate failed")
    log("Container recreated")

    log("Waiting for health check ...")
    time.sleep(8)
    rc, out, err = sudo_exec(client,
        f"curl -sf http://127.0.0.1:9000/api/v1/health | python3 -m json.tool 2>/dev/null || true",
        timeout=30
    )
    log(f"Health: {out.strip()}")

    rc, out, err = sudo_exec(client, f"docker logs --tail 20 {CONTAINER}", timeout=30)
    log("Recent backend logs:")
    print(out)


def main():
    skip_build = "--skip-build" in sys.argv
    skip_migrations = "--skip-migrations" in sys.argv
    if not skip_build:
        build_frontend()
    tar_path = make_tarball()
    client = None
    try:
        client = upload_and_extract(tar_path)
        if not skip_migrations:
            apply_migrations(client)
        recreate_backend(client)
        log("Deployment to 1号机 complete")
        log(f"Health URL: http://{HOST}:9000/api/v1/health")
    finally:
        if client:
            client.close()
        try:
            os.remove(tar_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
