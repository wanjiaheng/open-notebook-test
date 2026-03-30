# 运维部署文档

> **项目**：Open Notebook 多租户用户管理扩展  
> **版本**：v1.0  
> **日期**：2026-03-15  

---

## 1. 系统架构

```
┌──────────────────────────────────────────────────────┐
│                  Docker Compose                       │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │           open_notebook 容器                     │ │
│  │                                                 │ │
│  │   supervisord                                   │ │
│  │   ├── uvicorn (FastAPI)      :5055              │ │
│  │   └── node (Next.js)         :8502              │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │           surrealdb 容器                         │ │
│  │   SurrealDB v2 (RocksDB)     :8000              │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

外部暴露：
  8502  →  前端 Web UI
  5055  →  后端 REST API
  8000  →  SurrealDB（建议生产环境不对外暴露）
```

---

## 2. 前置依赖

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| Docker | ≥ 24.0 | 容器运行时 |
| Docker Compose | ≥ 2.20 | 编排工具 |
| 磁盘空间 | ≥ 5 GB | 含镜像、数据、日志 |
| 内存 | ≥ 2 GB | 建议 4 GB 以上 |

---

## 3. 首次部署

### 3.1 克隆项目

```bash
git clone https://github.com/your-org/open-notebook.git
cd open-notebook
```

### 3.2 配置环境变量

复制并编辑环境变量文件：

```bash
cp .env.example docker.env
```

编辑 `docker.env`，**必填项**：

```ini
# ============================================================
# 必填项
# ============================================================

# 加密密钥（用于 API 凭证加密），最少16位字符
OPEN_NOTEBOOK_ENCRYPTION_KEY=your-secret-key-here-min-16-chars

# JWT 签名密钥（用于用户 Token 签名），建议与上面不同
JWT_SECRET=your-jwt-secret-key-here

# ============================================================
# 数据库配置（默认与 docker-compose 一致，通常无需修改）
# ============================================================
SURREAL_URL=ws://surrealdb:8000/rpc
SURREAL_USER=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=open_notebook
SURREAL_DATABASE=open_notebook

# ============================================================
# 可选项
# ============================================================

# AI 模型 API Key（也可通过 UI 配置）
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_API_KEY=...
```

> ⚠️ **安全提示**：生产环境必须设置强随机 `OPEN_NOTEBOOK_ENCRYPTION_KEY` 和 `JWT_SECRET`，不得使用默认值。

### 3.3 构建并启动

```bash
# 开发/本地环境（本地构建镜像）
docker compose -f docker-compose.dev.yml up -d

# 等待服务就绪（约 60-120 秒）
docker logs open-notebook-open_notebook-1 -f
# 看到以下日志表示就绪：
# INFO success: frontend entered RUNNING state
```

### 3.4 访问服务

| 服务 | 地址 |
|------|------|
| 前端 Web UI | http://localhost:8502 |
| 后端 API 文档 | http://localhost:5055/docs |
| SurrealDB | http://localhost:8000 |

### 3.5 初始化超级管理员

首次启动后，系统无用户。通过 API 或直接数据库创建第一个超级管理员：

```bash
# 方法1：调用注册接口后手动提权
curl -X POST http://localhost:5055/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"yourpassword"}'

# 然后通过 SurrealDB 直接提权（替换 app_user:xxxx 为实际ID）
# 在 SurrealDB Surrealist 或 CLI 执行：
UPDATE app_user:xxxx SET role = 'admin', status = 'active';
```

---

## 4. 更新部署

### 4.1 拉取最新代码

```bash
git pull origin main
```

### 4.2 重新构建并重启

```bash
# 重新构建镜像（不使用缓存）
docker compose -f docker-compose.dev.yml build --no-cache open_notebook

# 重启服务
docker compose -f docker-compose.dev.yml up -d open_notebook
```

> 💡 **注意**：数据库迁移在 API 启动时自动运行，无需手动执行迁移脚本。

### 4.3 仅前端/后端代码更新

如果只改了代码（未改依赖），可以使用缓存构建：

```bash
docker compose -f docker-compose.dev.yml build open_notebook
docker compose -f docker-compose.dev.yml up -d open_notebook
```

---

## 5. 数据持久化

### 5.1 数据目录

| 路径 | 内容 | 重要性 |
|------|------|--------|
| `./surreal_data/` | SurrealDB 数据文件（RocksDB） | ⭐⭐⭐ 关键 |
| `./notebook_data/` | 用户上传文件、SQLite 检查点 | ⭐⭐⭐ 关键 |

### 5.2 备份策略

```bash
# 停服备份（推荐）
docker compose -f docker-compose.dev.yml stop

# 备份数据库文件
tar -czf backup-$(date +%Y%m%d).tar.gz ./surreal_data ./notebook_data

# 恢复服务
docker compose -f docker-compose.dev.yml start
```

```bash
# 在线热备（风险稍高，数据库 RocksDB 可能有未刷写缓存）
cp -r ./surreal_data ./surreal_data_backup_$(date +%Y%m%d)
cp -r ./notebook_data ./notebook_data_backup_$(date +%Y%m%d)
```

---

## 6. 常用运维命令

### 6.1 查看服务状态

```bash
# 查看容器运行状态
docker compose -f docker-compose.dev.yml ps

# 查看所有日志（实时）
docker logs open-notebook-open_notebook-1 -f

# 查看最近100行日志
docker logs open-notebook-open_notebook-1 --tail 100

# 只看错误日志
docker logs open-notebook-open_notebook-1 2>&1 | grep ERROR
```

### 6.2 进入容器调试

```bash
# 进入应用容器
docker exec -it open-notebook-open_notebook-1 bash

# 测试 API 健康检查
curl http://localhost:5055/health

# 测试前端
curl http://localhost:8502
```

### 6.3 数据库操作

```bash
# 使用 SurrealDB CLI（在 surrealdb 容器内）
docker exec -it open-notebook-surrealdb-1 surreal sql \
  --conn ws://localhost:8000/rpc \
  --user root --pass root \
  --ns open_notebook --db open_notebook
```

常用 SQL：

```sql
-- 查看所有用户
SELECT id, username, email, role, status FROM app_user;

-- 激活用户
UPDATE app_user:xxxx SET status = 'active';

-- 提权为超级管理员
UPDATE app_user:xxxx SET role = 'admin';

-- 查看迁移版本
SELECT * FROM _sbl_migrations ORDER BY version;

-- 查看组织列表
SELECT id, name FROM organization;
```

### 6.4 重启单个服务

```bash
# 重启应用（不重建镜像）
docker compose -f docker-compose.dev.yml restart open_notebook

# 重启数据库
docker compose -f docker-compose.dev.yml restart surrealdb
```

### 6.5 清理与重置

```bash
# 停止所有服务
docker compose -f docker-compose.dev.yml down

# 完全重置（⚠️ 删除所有数据！）
docker compose -f docker-compose.dev.yml down -v
rm -rf ./surreal_data ./notebook_data
```

---

## 7. 监控与告警

### 7.1 健康检查端点

```
GET http://localhost:5055/health
→ 返回 200 表示 API 正常
```

### 7.2 关键日志模式

| 日志内容 | 含义 | 处理方式 |
|----------|------|----------|
| `API initialization completed successfully` | 启动成功 | 正常 |
| `ERROR ... Migration` | 数据库迁移失败 | 检查 DB 连接，查看迁移日志 |
| `ERROR ... ValidationError` | 数据校验失败 | 检查 API 调用参数 |
| `RuntimeError: Failed to create record` | 写库失败 | 检查 SurrealDB 状态 |
| `frontend entered RUNNING state` | 前端启动成功 | 正常 |

### 7.3 SurrealDB 监控

```bash
# 检查 SurrealDB 是否正常响应
docker exec open-notebook-surrealdb-1 \
  surreal is-ready --conn ws://localhost:8000/rpc
```

---

## 8. 反向代理配置（生产环境）

### 8.1 Nginx 示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    # 前端
    location / {
        proxy_pass http://localhost:8502;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:5055;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

### 8.2 配置自定义域名

在 `docker.env` 中设置：

```ini
API_URL=https://your-domain.com/api
```

---

## 9. 故障排查

### 问题：容器启动后立即退出

```bash
# 查看退出原因
docker logs open-notebook-open_notebook-1

# 常见原因：
# 1. docker.env 文件不存在
# 2. OPEN_NOTEBOOK_ENCRYPTION_KEY 未设置
# 3. SurrealDB 未启动（先启动 surrealdb）
```

### 问题：登录失败（Token 错误）

```bash
# 检查 JWT_SECRET 是否设置
docker exec open-notebook-open_notebook-1 \
  env | grep JWT_SECRET

# 清除浏览器 LocalStorage 后重试
```

### 问题：数据库迁移失败

```bash
# 查看迁移相关日志
docker logs open-notebook-open_notebook-1 2>&1 | grep -i migration

# 手动检查迁移状态
docker exec -it open-notebook-surrealdb-1 surreal sql \
  --conn ws://localhost:8000/rpc \
  --user root --pass root \
  --ns open_notebook --db open_notebook \
  --query "SELECT * FROM _sbl_migrations ORDER BY version;"
```

### 问题：来源/笔记本不显示

```bash
# 检查 API 日志中的查询错误
docker logs open-notebook-open_notebook-1 2>&1 | grep "ERROR.*source\|ERROR.*notebook"

# 常见原因：
# 1. array::intersect 调用时 org_ids 为 NULL
#    → 已通过 IS NOT NONE 检查修复
# 2. SELECT id 与 SELECT VALUE id 混用
#    → 已修复为 SELECT VALUE id
```

---

## 10. 版本升级记录

| 日期 | 变更内容 | 涉及迁移 |
|------|----------|----------|
| 2026-03-15 | 添加用户鉴权、多租户组织、多组织笔记本 | Migration 15-19 |
