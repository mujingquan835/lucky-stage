# Lucky Stage · 幸运现场活动抽奖工作台

<p align="center">
  <strong>面向企业年会、客户答谢会、线下沙龙与促销活动的一体化 Web 抽奖与大屏投屏系统</strong>
</p>

<p align="center">
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" />
  <img alt="PostgreSQL / PGlite" src="https://img.shields.io/badge/Database-PostgreSQL%20%7C%20PGlite-4169E1?logo=postgresql&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-f59e0b" />
</p>

**Lucky Stage（幸运现场）** 是一套开箱即用、注重**现场稳定性与资金级数据一致性**的全栈 Web 抽奖系统。它既支持在个人电脑上通过嵌入式 PostgreSQL（PGlite）**零配置秒启动**，也支持通过 **Docker Compose + PostgreSQL + Caddy (HTTPS)** 部署至云服务器供多端协同与手机端自助抽奖。

---

## 核心亮点与特点

### 1. 双核心抽奖模式，覆盖主流活动场景
- **按奖项抽人（年会 / 舞台主持模式）**：选定奖项与本轮人数（单轮最高 50 人），从当前符合资格的名单中等概率无放回抽取；支持**人物照片滚动**（缺图自动降级为姓名卡片），支持会前编排预设轮次。
- **按人抽礼品（客户答谢 / 促销回馈模式）**：选定一位到场来宾，系统按奖池内各礼品的**剩余库存加权随机**抽出礼品；同时支持按剩余库存随机批量发奖与单批上限控制。
- **多场独立活动隔离**：单管理员可并行管理多场活动，活动间名单、奖品、记录完全隔离；活动结束后支持归档只读或一键复制配置开启下一场。

### 2. 三端协同的舞台与主持体验
- **16:9 现场投屏大屏**：由主持台实时切换欢迎页、礼品墙、三列礼品摇奖机 / 人物滚轴、中奖墙（每页 8 人同步翻页）与结束页。
- **专业主持控制台**：内置 **3-2-1 倒计时、彩带特效、滚动与揭晓音效**、支持上传自定义背景音乐（MP3/WAV/OGG，最大 15MB）；支持快捷键操作（`Space` 开始/停止、`F` 全屏、`M` 静音、`R` 重播动画、方向键翻页），重播仅回放视觉，不生成新结果。
- **独立彩排沙盒**：主持台一键进入彩排模式，基于内存副本完整演练流程，绝不污染正式库存与中奖记录。
- **手机主持台（扫码遥控）**：控制台一键生成二维码，手机扫码登录后即可在舞台或台下遥控加奖、开奖、停止揭晓与切换大屏。

### 3. 个人抽奖码自助抽奖 + 实时自助大屏
- **时间窗口与开关控制**：按北京时间（UTC+8）设定自助抽奖起止时间，随时一键启停。
- **高安全个人抽奖码**：一键为名单生成 20 位随机抽奖码并导出 CSV；支持增量补生成（不覆盖旧码）与单人换码（旧码与旧会话立即失效）。
- **手机端自助体验**：来宾无需注册账号，凭码即可体验同款三列礼品滚轴、查看本人中奖历史与奖品图片；抽奖次数与奖池库存与现场主持台**实时共享**。
- **自助抽奖实时大屏**：新中奖记录先居中放大展示 2 秒，再平滑落入 `3×4`（12 人/页）网格自动轮播，自动对姓名与门店做脱敏打码，且具备**防剧透机制**（用户停止揭晓或 30 秒自动揭晓前不提前在大屏露出）。

### 4. 事务级数据一致性与抗故障设计
- **服务端安全随机 + 活动级数据库锁**：随机抽样、库存校验与扣减、资格更新、作废恢复全部在服务端数据库事务与活动级锁内原子执行，前端动画绝不篡改结果；高并发争抢最后 1 份库存零超发。
- **全链路幂等与断网恢复**：每次抽奖请求均携带唯一请求 ID；遇到网络抖动、超时或页面刷新，直接沿用原请求 ID 查询并恢复结果，杜绝重复扣库存或重复中奖。
- **完整核销与可追溯作废**：支持中奖明细 Excel 导出、领奖核销、带原因撤销核销与作废；作废自动释放礼品库存并恢复参与者对应抽奖机会，所有操作全程留痕。

### 5. 高效的名单、物料与测试工具箱
- **多工作表 Excel 智能导入**：提供标准 `.xlsx` 模板，自动读取所有非空工作表，按姓名+电话合并并累计个人抽奖机会（支持 1–10000 次）；导入前先预览校验，拦截冲突行，不静默丢弃数据。
- **批量匹配人物照片**：支持按照片文件名或唯一姓名批量预览绑定，不改动抽奖次数。
- **独立测试活动**：一键创建带【测试】标记的隔离活动，内置一键生成 20/100/1000 名虚构来宾、补齐示例礼品与一键清空测试结果功能，方便会前全真压测与演练。

### 6. 安全与隐私保护
- **最小暴露原则**：完整手机号仅管理员登录后在后台查看和导出，大屏接口与投屏页面绝不下发手机号；自助参与者采用独立的 12 小时 `HttpOnly` 会话，严禁越权访问管理接口或他人记录。
- **上传与访问防护**：所有 API 强制登录与输入校验、修改请求校验来源（Origin）、登录及自助接口内置分级限流；图片与音频上传通过魔数校验真实文件类型，不信任文件扩展名。

---

## 技术栈

| 层级 | 技术选型 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 6、纯 CSS 响应式舞台动效 |
| 后端 | Node.js 24、Express 5、TypeScript (`tsx`) |
| 数据库 | 本地默认嵌入式 PostgreSQL（`@electric-sql/pglite`），生产无缝切换标准 PostgreSQL 16/17（`pg`） |
| 媒体与文档 | `sharp`（图片安全转码与校验）、`exceljs`（Excel 导入导出）、`qrcode`（手机主持台二维码） |
| 部署与运维 | Docker、Docker Compose、Caddy（自动 HTTPS）、一键快照备份/恢复脚本 |
| 质量保障 | Node Test Runner 单元与 API 集成测试、Playwright E2E 端到端测试、并发压力测试脚本 |

---

## 快速开始

### 方式一：本地零配置启动（推荐体验）

需要 **Node.js 24+**。在项目根目录执行：

```bash
npm ci
npm run build
npm run local:start
```

- macOS 用户也可以直接双击项目根目录的 `启动抽奖工作台.command` 一键构建并后台启动。
- 启动后访问：**http://localhost:3000**
- 首次启动会自动在根目录生成 `.env` 文件，默认管理员账号为 `admin`，随机生成的初始密码保存在 `.env` 的 `ADMIN_PASSWORD` 字段中（不会在页面或日志中明文打印）。
- 本地默认使用 `data/pglite` 持久化数据库和 `data/uploads` 文件目录，重启后数据完整保留。
- 查看后台服务状态：`npm run local:status`；如需前台调试运行：`npm start`。

> **提示**：同一个 PGlite 本地数据目录同一时间仅支持单个进程打开，执行本地数据备份前请先停止应用。

### 方式二：Docker Compose 生产部署（PostgreSQL + HTTPS）

1. 复制并配置环境变量：

```bash
cp .env.example .env
# 编辑 .env，填写 ADMIN_PASSWORD、POSTGRES_PASSWORD、APP_DOMAIN、APP_ORIGIN
```

2. 启动应用与 PostgreSQL（配合已有 Nginx/反代）：

```bash
docker compose up -d --build
```

3. 如需同时启用 Caddy 自动申请 Let's Encrypt HTTPS 证书：

```bash
docker compose --profile https up -d --build
```

更多生产运维、反向代理配置与数据迁移细节请参考 [部署与备份指南](docs/maintenance/deployment.md)。

---

## 开发、测试与维护

```bash
# 类型检查
npm run typecheck

# 运行单元与接口集成测试（包含并发锁、幂等、权限、自助抽奖等）
npm test

# 构建前端产物
npm run build

# 运行 Playwright 浏览器端到端测试（需本机已安装 Chrome，使用隔离临时目录）
npm run test:e2e

# 运行隔离并发压力测试（模拟 20 并发、1000 名单、200 次抽奖与最后库存争抢）
npm run test:pressure

# 数据与附件联合快照备份 / 恢复
npm run backup
npm run restore
```

---

## 目录结构

```text
├── server/                 # Node.js + Express 服务端（业务域、数据库锁、安全、自助抽奖、Excel 处理）
├── shared/                 # 前后端共享类型与舞台/自助状态协议
├── web/                    # React 19 前端（管理后台、主持控制台、手机主持台、投屏大屏、自助抽奖端）
│   └── public/campaign/    # 通用主题视觉素材与音效资源（可自由替换定制）
├── scripts/                # 本地守护启动、隔离压测、备份与恢复脚本
├── tests/                  # 单元测试、API 集成测试与 Playwright E2E 测试
├── docs/
│   ├── maintenance/        # 架构说明、部署与备份文档
│   └── superpowers/specs/  # 核心业务与舞台演进设计文档
├── Dockerfile              # 生产镜像构建文件
├── compose.yaml            # Docker Compose 编排（App + PostgreSQL + 可选 Caddy）
└── Caddyfile               # 自动 HTTPS 反向代理配置
```

---

## 相关文档

- [系统架构与维护说明](docs/maintenance/architecture.md)
- [生产部署、HTTPS 与备份恢复指南](docs/maintenance/deployment.md)
- [核心活动抽奖系统设计稿](docs/superpowers/specs/2026-10-27-event-lottery-design.md)
- [V2 现场舞台与主持控制台设计稿](docs/superpowers/specs/2026-10-29-stage-v2-design.md)
- [用户自助抽奖与自助大屏设计稿](docs/superpowers/specs/2026-11-16-self-service-lottery-design.md)
- [年会主持模式与手机遥控设计稿](docs/superpowers/specs/2026-11-18-annual-meeting-stage-design.md)

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源，欢迎二次开发、定制视觉主题或提交 PR。
