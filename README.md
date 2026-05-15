# 山顶咖啡值班签到系统

山顶咖啡值班签到系统是一个给咖啡屋内部使用的轻量考勤工具，用于记录值班人员每天的签到、签退、补签申请、补签审核、月度统计和 Excel 导出。

当前 `server` 分支适合部署到本地服务器、阿里云服务器或 Docker 环境，使用 SQLite 本地数据库保存数据。

## 功能概览

### 员工端

- 查看当前可选的值班人员。
- 选择本人后进行签到。
- 已签到后进行签退。
- 查看当天签到、签退和总工时记录。
- 忘记签到或签退时提交补签申请。
- 手机优先设计，适合在店内手机浏览器中快速使用。
- 支持 PWA 基础能力，可添加到手机桌面。

### 管理员端

- 管理员密码登录。
- 添加、编辑、停用值班人员。
- 查看所有签到 / 签退记录。
- 查看补签申请列表，并按状态筛选。
- 审核补签申请，支持通过或拒绝。
- 审核通过后自动写入或更新对应考勤记录。
- 查看月度统计，包括出勤次数、完整记录、不完整记录、异常记录和总工时。
- 导出月度 Excel 文件，包含月度汇总和考勤明细两个 sheet。
- 修改管理员密码。

## 使用流程

1. 部署项目并配置环境变量。
2. 访问 `/api/setup?secret=你的SETUP_SECRET` 初始化 SQLite 数据库和默认管理员。
3. 使用默认管理员密码 `1234` 登录管理端。
4. 在管理端添加值班人员。
5. 员工在首页选择自己的名字并签到 / 签退。
6. 如忘记签到或签退，员工提交补签申请。
7. 管理员在管理端审核补签申请。
8. 月底查看统计并导出 Excel 留档。

上线后请立即在管理面板修改默认管理员密码。

## 技术栈

- Node.js
- Express
- SQLite
- `better-sqlite3`
- `xlsx`
- 原生 HTML/CSS/JS

## 项目结构

```text
public/
  index.html
  manifest.json
  sw.js
  assets/

db/
  sqliteStore.js

data/
  .gitkeep

server.js
package.json
package-lock.json
Dockerfile
docker-compose.yml
.dockerignore
.env.example
README.md
```

## 数据说明

SQLite 数据库文件默认保存在：

```text
data/cafepunch.sqlite
```

主要数据包括：

- `members`：值班人员。
- `records`：签到、签退记录。
- `adjustment_requests`：补签申请。
- `admins`：管理员账号信息。

数据库访问逻辑集中在：

```text
db/sqliteStore.js
```

`server.js` 保留 API handler 结构。以后如果要切换到其他数据库，优先替换 store 层，尽量不要重写业务 API。

## 环境变量

复制 `.env.example` 为 `.env`，并按实际环境配置：

```env
SETUP_SECRET=replace-with-random-secret
PORT=3000
SQLITE_DB_PATH=./data/cafepunch.sqlite
```

不要提交真实 `.env`。

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:3000
```

初始化 SQLite 数据库和默认管理员：

```text
http://localhost:3000/api/setup?secret=你的SETUP_SECRET
```

默认管理员密码：

```text
1234
```

## Docker 运行

```bash
cp .env.example .env
docker compose up -d --build
```

Docker Compose 会把本地 `./data` 挂载到容器的 `/app/data`，SQLite 数据文件默认保存为：

```text
data/cafepunch.sqlite
```

## 阿里云服务器 / 本地服务器部署

1. 安装 Node.js 20 或使用 Docker。
2. 上传项目文件。
3. 配置 `.env`。
4. 执行 `npm install`。
5. 执行 `npm start`。
6. 访问 `/api/setup?secret=你的SETUP_SECRET` 初始化数据库。
7. 登录管理端并修改默认管理员密码。
8. 可使用 Nginx 做反向代理和 HTTPS。

## 数据备份

备份时复制 SQLite 数据文件即可：

```text
data/cafepunch.sqlite
```

运行中如果存在 WAL 文件，也一起备份：

```text
data/cafepunch.sqlite
data/cafepunch.sqlite-shm
data/cafepunch.sqlite-wal
```

注意：

- 不要删除 `data/` 目录。
- 不要执行 `docker compose down -v` 删除数据卷。
- 不要提交 `.env` 和 `data/*.sqlite`。

## API

保留原有 API 路径：

```text
GET  /api/setup
GET  /api/members
GET  /api/records/today
POST /api/checkin
POST /api/checkout
POST /api/adjustment-requests
POST /api/admin/login
GET  /api/admin/members
POST /api/admin/members
PUT  /api/admin/members
POST /api/admin/members/deactivate
GET  /api/admin/records
GET  /api/admin/adjustment-requests
POST /api/admin/adjustment-requests/review
GET  /api/admin/stats/monthly
GET  /api/admin/export/monthly.xlsx
PUT  /api/admin/password
```

## 维护建议

- 部署前确认 `.env` 中的 `SETUP_SECRET` 已设置为随机强密钥。
- 首次上线后立即修改管理员默认密码。
- 定期备份 `data/cafepunch.sqlite`。
- 更新前端样式或静态资源后重新部署即可，Service Worker 会自动刷新旧缓存。
