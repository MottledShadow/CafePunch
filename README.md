# 山顶咖啡值班签到系统

这是一个适合本地服务器、阿里云服务器或 Docker 环境部署的 Node.js 应用。当前 `server` 分支使用 SQLite 本地数据库。

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

上线后请立即在管理面板修改。

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
7. 可使用 Nginx 做反向代理和 HTTPS。

## 数据备份

SQLite 数据文件位于：

```text
data/cafepunch.sqlite
```

备份时复制这个文件即可。运行中如果存在 WAL 文件，也一起备份：

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

## 数据访问层

SQLite 数据库操作集中在：

```text
db/sqliteStore.js
```

`server.js` 继续保留原 API handler 结构。以后如需切换数据库，优先替换 store，不重写业务 API。
