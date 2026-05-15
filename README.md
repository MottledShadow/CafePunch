# 咖啡屋值班签到系统

这是一个可移植的标准 Node.js Express + Postgres + Docker 应用。

CloudBase 只作为 Docker 容器运行平台使用，本项目没有使用 CloudBase 的数据库、云函数、登录认证或任何平台 SDK。

## 技术栈

- Node.js
- Express
- Postgres，使用 `pg`
- `xlsx`
- 原生 HTML/CSS/JS
- Dockerfile
- 环境变量

## 项目结构

```text
public/
  index.html
  manifest.json
  sw.js

server.js
package.json
package-lock.json
Dockerfile
.dockerignore
.env.example
README.md
```

## 环境变量

复制 `.env.example` 为 `.env`，并按实际环境配置：

```env
DATABASE_URL=postgres://user:password@host:5432/dbname
SETUP_SECRET=replace-with-random-secret
PORT=3000
```

不要把真实 `.env`、`.env.local` 或数据库连接串提交到仓库。

本地运行时会自动读取 `.env`；在 CloudBase Run、Docker 或服务器进程管理器中，也可以直接使用平台环境变量。

## 本地运行

```bash
npm install
npm start
```

然后访问：

```text
http://localhost:3000
```

初始化数据库：

```text
http://localhost:3000/api/setup?secret=你的SETUP_SECRET
```

默认管理员密码：

```text
1234
```

上线后请立即在管理面板修改。

## A. CloudBase 云托管试用部署

1. 创建 CloudBase 环境。
2. 进入云托管 / CloudBase Run。
3. 使用本项目的 `Dockerfile` 部署。
4. 配置环境变量 `DATABASE_URL`、`SETUP_SECRET`，可按需配置 `PORT=3000`。
5. 端口设置为 `3000`。
6. 部署后访问 CloudBase 分配的域名。
7. 初始化数据库：

```text
/api/setup?secret=你的SETUP_SECRET
```

注意：CloudBase 在这里仅作为容器运行平台。本项目没有使用 CloudBase 数据库、云函数、认证、SDK 或任何 CloudBase 专有业务入口。

## B. 腾讯云服务器部署

可以使用 Node.js 直接运行，也可以使用 Docker。

### Node.js 方式

1. 在轻量服务器或 CVM 安装 Node.js。
2. 上传项目代码。
3. 配置 `.env` 或在进程环境中设置 `DATABASE_URL`、`SETUP_SECRET`、`PORT`。
4. 安装依赖并启动：

```bash
npm install
npm start
```

### Docker 方式

```bash
docker build -t cafe-checkin .
docker run -d -p 3000:3000 --env-file .env cafe-checkin
```

后续可以用 Nginx 做反向代理和 HTTPS。

## API

迁移后保留原有 API 路径：

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

## 验收清单

- `npm install` 成功。
- `npm start` 后访问 `http://localhost:3000` 能打开页面。
- `/api/setup?secret=正确值` 可以初始化数据库。
- 管理员登录正常。
- 添加值班人员正常。
- 签到/签退正常。
- 补签申请和审核正常。
- 月度统计正常。
- Excel 导出正常。
- 项目不依赖 Vercel Serverless。
- 项目不依赖 CloudBase 专有 API。
- CloudBase 和腾讯云服务器部署使用同一套代码。
