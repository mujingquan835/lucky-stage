# 部署与数据恢复

## 云服务器部署

需要安装 Docker Compose 的服务器、已解析到该服务器的域名，以及开放的 80/443 端口。不需要开放 PostgreSQL 端口。

1. 上传代码，复制 `.env.example` 为 `.env`。
2. 设置 `ADMIN_PASSWORD`、`POSTGRES_PASSWORD` 为不同的随机十六进制字符串，至少 24 位；设置 `APP_DOMAIN` 和 `APP_ORIGIN=https://你的域名`。可使用 `openssl rand -hex 24` 生成密码。不要提交 `.env`。
3. `mkdir -p backups`。容器应用使用 UID 1000，确保备份目录可以由 UID 1000 写入（例如由部署管理员执行 `chown 1000:1000 backups`）。
4. 执行 `docker compose --profile https up -d --build`。
5. 查看 `docker compose ps` 和 `docker compose logs --tail=60 app caddy`，用域名登录。Caddy 自动申请 HTTPS 证书，需要域名解析正确且 80/443 可达。
6. 在正式活动前使用虚构数据演练：Excel、图片、两种抽奖、大屏同步、断网查询恢复、作废及备份恢复；使用浏览器另开设备并发抽奖验证 PostgreSQL。

已有反向代理时可以不启动 https profile，将域名反代到服务器 127.0.0.1:3000；不要把 app HTTP 端口直接公开。`APP_ORIGIN` 必须与浏览器访问的 HTTPS 地址完全一致，包括端口且末尾不加斜杠。

生产模式强制使用 PostgreSQL 和 HTTPS 配置；会话 cookie 带 Secure 标记，通过 HTTP 不会正常登录。管理员首次登录密码由部署环境提供，不存在固定默认生产密码。

## 备份

备份格式是一个目录，包含数据库活动 JSON、引用图片、背景音乐和 SHA-256 清单，不包含登录会话与管理员密码。备份包含完整电话，须按活动原始数据管理，保存到受限目录。

云端运行：

```sh
docker compose exec app npm run backup -- /app/backups/2026-10-27-before-event
```

备份使用单条查询取得全部活动的一致快照，图片不可变且先落盘后引用，因此可在 PostgreSQL 服务运行时执行。若中途失败，目录可能保留，但没有完整有效 manifest 的备份不能恢复。备份目录必须是新的，避免覆盖旧备份。把整个备份目录复制到另一台设备，不要仅保存 JSON 或仅保存图片。

本地 PGlite：先在启动终端 Ctrl+C 停止服务，然后：

```sh
mkdir -p backups
CONFIRM_LOCAL_STOPPED=yes npm run backup -- "$PWD/backups/2026-10-27-before-event"
```

完成后 `npm start` 恢复服务。不要同时打开同一 PGlite 目录。

## 恢复

恢复工具校验所有数据、图片和音乐哈希；**仅允许恢复到空数据库**，拒绝覆盖已有活动。

本地恢复演练（先停止本地服务）：

```sh
DATA_DIR="$PWD/data-restored" CONFIRM_LOCAL_STOPPED=yes npm run restore -- "$PWD/backups/2026-10-27-before-event"
DATA_DIR="$PWD/data-restored" npm start
```

云端恢复：先 `docker compose stop app`，在 PostgreSQL 中建立一个新空数据库。将 `.env` 的 `DATABASE_URL` 设置为该新库（Compose 支持此覆盖；使用 db 服务时主机名为 `db`），并将整份备份放到挂载的 `/app/backups` 下。执行 `docker compose run --rm app npm run restore -- /app/backups/备份目录`，它和后续启动均使用 `.env` 指定的新库。确认恢复成功后执行 `docker compose up -d app`，登录核对名单、礼品、库存和记录；核对失败则停止 app，将 `.env` 的 `DATABASE_URL` 改回旧库并重新创建 app 容器。切换数据库前保留原库，不运行 `docker compose down -v`，避免删除原数据卷。恢复操作会清空目标库的登录会话，需要重新登录。

## 更新

先做备份，记录当前 Git commit，然后更新代码并 `docker compose --profile https up -d --build`。数据库与图片均在持久卷中，不随容器重建删除。首版启动仅创建缺失表，无破坏性 schema 迁移；后续字段变化必须提供兼容读取或明确迁移步骤。

若升级异常，保留新旧数据，回退代码和镜像；存在不兼容数据变更时使用备份恢复到新数据库验证后再切换。每次正式活动前至少演练一次恢复。

仅当应用前方恰好有一层受控反向代理时设置 `TRUST_PROXY=1`。提供的 Compose 默认启用，Caddy 强制覆写 X-Forwarded-For，app 端口仅绑定本机。独立直连服务保持关闭；增加代理层时需重新审核信任边界。
