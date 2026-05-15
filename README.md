# 咖啡屋值班签到系统

这是一个 Express + CloudBase 云数据库版本。当前版本深度绑定 CloudBase 云数据库，CloudBase 负责运行容器和保存业务数据。

未来如果迁移到本地服务器，建议保留 `server.js` 的 API handler，只替换 `db/cloudbaseStore.js` 为本地数据库实现。

## 技术栈

- Node.js
- Express
- CloudBase 云数据库，使用 `@cloudbase/node-sdk`
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

db/
  cloudbaseStore.js

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
CLOUDBASE_ENV_ID=your-cloudbase-env-id
SETUP_SECRET=replace-with-random-secret
PORT=3000
TENCENTCLOUD_SECRETID=optional-for-local-development
TENCENTCLOUD_SECRETKEY=optional-for-local-development
```

说明：

- `CLOUDBASE_ENV_ID`：CloudBase 环境 ID。
- `SETUP_SECRET`：保护 `/api/setup`。
- `PORT`：本地或容器监听端口，默认 `3000`。
- `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`：本地开发可选。云托管如果支持免密访问，优先不配置密钥。

不要把真实 `.env`、`.env.local`、SecretId 或 SecretKey 提交到仓库。

## CloudBase 部署

1. 创建 CloudBase 环境。
2. 开启 CloudBase 云数据库。
3. 在云数据库中创建集合：

```text
members
records
adjustment_requests
admins
```

4. 使用 CloudBase 云托管 / CloudBase Run 部署当前 Express 项目。
5. 配置环境变量：

```text
CLOUDBASE_ENV_ID
SETUP_SECRET
PORT=3000
```

6. 如果云托管环境不能免密访问 CloudBase 数据库，再配置：

```text
TENCENTCLOUD_SECRETID
TENCENTCLOUD_SECRETKEY
```

7. 部署后访问：

```text
/api/setup?secret=你的SETUP_SECRET
```

`/api/setup` 会尽量自动确保集合存在，并在没有管理员时创建默认管理员。不同 CloudBase 环境的集合创建权限可能不同；如果自动创建失败，请在控制台手动创建上面四个集合后重新访问 `/api/setup`。

默认管理员密码：

```text
1234
```

上线后请立即在管理面板修改。

## 本地开发

```bash
npm install
npm start
```

然后访问：

```text
http://localhost:3000
```

本地开发访问 CloudBase 数据库时，通常需要在 `.env` 中配置 `CLOUDBASE_ENV_ID`，并按需配置 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`。

## Docker

```bash
docker build -t cafe-checkin .
docker run -d -p 3000:3000 --env-file .env cafe-checkin
```

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

CloudBase 数据库操作集中在：

```text
db/cloudbaseStore.js
```

`server.js` 不直接调用 `db.collection(...)`。未来迁移到本地服务器时，重写这个 store 即可。

## 验收清单

- `npm install` 成功。
- `npm start` 能启动。
- 项目中不再依赖 PostgreSQL 驱动。
- 项目中不再需要旧版数据库连接串变量。
- CloudBase 集合可以正常读写。
- `/api/setup?secret=正确值` 可以初始化默认管理员。
- 管理员登录正常。
- 添加值班人员正常。
- 公共端能加载 active 值班人员。
- 签到/签退正常。
- 补签申请和审核正常。
- 月度统计正常。
- Excel 导出正常。
- 项目里没有真实 SecretId / SecretKey。
