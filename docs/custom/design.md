# 开发设计文档

> **项目**：Open Notebook 多租户用户管理扩展  
> **版本**：v1.0  
> **日期**：2026-03-15  

---

## 1. 技术架构概览

```
┌────────────────────────────────────────────────────────┐
│               Frontend (Next.js 16 / React 19)          │
│               端口 8502 | Tailwind + Shadcn/ui           │
│  Zustand (auth-store) · TanStack Query · react-i18next  │
└─────────────────────────┬──────────────────────────────┘
                          │ HTTP REST + JWT
┌─────────────────────────▼──────────────────────────────┐
│               API (FastAPI)   端口 5055                  │
│  JWTAuthMiddleware · Routers · Services · LangGraph     │
└─────────────────────────┬──────────────────────────────┘
                          │ SurrealQL (WebSocket)
┌─────────────────────────▼──────────────────────────────┐
│               SurrealDB v2   端口 8000                   │
│  SCHEMAFULL tables · Graph edges · Vector embeddings    │
└────────────────────────────────────────────────────────┘
```

---

## 2. 认证与授权设计

### 2.1 认证流程

```
用户 POST /api/login
  → 验证邮箱/密码 (bcrypt)
  → 检查 status == 'active'
  → 查询 member_of 获取 admin_org_ids
  → 生成 JWT { sub, username, role, admin_org_ids }
  → 返回 { token, user }
```

### 2.2 JWT Payload 结构

```json
{
  "sub": "app_user:xxxx",
  "username": "张三",
  "role": "user",
  "admin_org_ids": ["organization:aaa", "organization:bbb"],
  "exp": 1234567890
}
```

| 字段 | 说明 |
|------|------|
| `sub` | 用户 RecordID（`app_user:xxx`） |
| `role` | 全局角色：`user` 或 `admin` |
| `admin_org_ids` | 该用户为组内管理员的组织 ID 列表 |

### 2.3 中间件

`api/auth.py` 中的 `JWTAuthMiddleware`：
- 白名单：`/api/login`、`/api/register`、`/health`、文档路径
- 其余路径提取并验证 Bearer Token
- 将解析后的用户信息注入 `request.state.user`

### 2.4 权限分层

```
超级管理员 (role=admin)
  └─ 查看所有数据，管理所有用户/组织

组内管理员 (role=user, admin_org_ids 非空)
  └─ 仅查看/管理所属 admin_org_ids 内的用户和数据

普通用户 (role=user, admin_org_ids=[])
  └─ 仅查看自己创建的数据 + 所属组织共享数据 + 公开数据
```

---

## 3. 数据模型设计

### 3.1 核心实体关系

```
app_user ──(member_of {role})──▶ organization
    │                                  │
    ▼                                  ▼
notebook (org_ids[])            notebook (org_ids[])
    │
    ▼
source (user_id, org_id)
```

### 3.2 数据模型详情

#### AppUser（`app_user` 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `record<app_user>` | 自动生成 |
| `username` | `string` | 唯一 |
| `email` | `string` | 唯一 |
| `password_hash` | `string` | bcrypt |
| `role` | `string` | `user` / `admin` |
| `status` | `string` | `pending` / `active` / `suspended` |
| `org_id` | `option<record<organization>>` | 遗留字段，逐步弃用 |
| `created` | `datetime` | 自动填充 |
| `updated` | `datetime` | 自动更新 |

#### Organization（`organization` 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `record<organization>` | 自动生成 |
| `name` | `string` | 唯一；`公开` 为系统保留 |
| `description` | `option<string>` | 可选描述 |

#### member_of（图边表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `in` | `record<app_user>` | 用户 |
| `out` | `record<organization>` | 组织 |
| `role` | `string` | `member` / `org_admin` |

唯一索引：`(in, out)`

#### Notebook（`notebook` 表，扩展字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | `option<record<app_user>>` | 创建者（Migration 16） |
| `org_ids` | `option<array<record<organization>>>` | 关联组织（Migration 18） |
| `org_id` | `option<record<organization>>` | 遗留字段，已被 `org_ids` 替代 |

#### Source（`source` 表，扩展字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | `option<record<app_user>>` | 创建者（Migration 16） |
| `org_id` | `option<record<organization>>` | 组织（旧逻辑） |

---

## 4. API 接口设计

### 4.1 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | 用户登录，返回 JWT |
| POST | `/api/register` | 用户注册（status=pending） |
| GET | `/api/me` | 获取当前用户信息 + 组织成员关系 |

### 4.2 用户管理接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/users` | admin/org_admin | 获取用户列表（按权限过滤） |
| POST | `/api/users` | admin/org_admin | 创建用户 |
| PATCH | `/api/users/{id}/status` | admin/org_admin | 更新用户状态 |
| POST | `/api/users/{id}/membership` | admin/org_admin | 添加组织关系 |
| DELETE | `/api/users/{id}/membership/{org_id}` | admin/org_admin | 移除组织关系 |
| PATCH | `/api/users/{id}/membership/{org_id}/role` | admin/org_admin | 设置组内角色 |

### 4.3 组织管理接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/organizations` | 已登录 | 获取组织列表（含「公开」） |
| POST | `/api/organizations` | superadmin | 创建组织 |
| PUT | `/api/organizations/{id}` | superadmin | 编辑组织（不可改名「公开」） |
| DELETE | `/api/organizations/{id}` | superadmin | 删除组织（不可删「公开」） |

### 4.4 笔记本接口（扩展）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notebooks` | 返回当前用户可见的笔记本（按 org_ids 过滤） |
| POST | `/api/notebooks` | 创建笔记本，支持 `org_ids` 参数 |
| PATCH | `/api/notebooks/{id}` | 更新笔记本，支持修改 `org_ids` |

### 4.5 来源接口（扩展）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sources` | 返回当前用户可见的来源（含公开笔记本的来源） |

---

## 5. 数据可见性规则

### 5.1 笔记本可见性

```python
用户可见的笔记本 =
    user_id = 当前用户                    # 自己创建的
    OR array::intersect(org_ids, 当前用户所属org_ids) != []  # 共享组
    OR (org_ids IS NONE AND user_id IS NONE)  # 旧无归属数据（兼容）
```

### 5.2 来源可见性

```python
用户可见的来源 =
    user_id = 当前用户                    # 自己创建的
    OR org_id IN 当前用户所属org_ids      # 所属组织的来源
    OR id IN (                           # 通过可见笔记本反推
        SELECT VALUE in FROM reference
        WHERE out IN (
            SELECT VALUE id FROM notebook
            WHERE array::intersect(org_ids, 当前用户org_ids+公开org) != []
        )
    )
```

> **关键**：查询时自动将「公开」组织加入用户的 `org_ids` 列表，确保公开内容对所有已登录用户可见。

---

## 6. 前端架构设计

### 6.1 状态管理

`frontend/src/lib/stores/auth-store.ts`（Zustand）：

```typescript
interface AuthState {
  user: UserWithMemberships | null
  token: string | null
  isAuthenticated: boolean
  memberships: MembershipInfo[]     // 组织关系
  setUser: (user, token) => void
  refreshUser: () => Promise<void>  // 刷新用户和组织信息
  logout: () => void
}
```

### 6.2 权限工具函数

`frontend/src/lib/api/organizations.ts`：

```typescript
export const PUBLIC_ORG_NAME = '公开'

// 判断是否是超级管理员
export function isSuperAdmin(user): boolean

// 判断用户是否为某组织的管理员
export function isOrgAdmin(user, orgId): boolean
```

### 6.3 路由保护

- `(auth)` 路由组：未登录跳转到 `/login`
- `(dashboard)` 路由组：需已登录且 `status=active`
- `/admin/*`：需 `role=admin` 或 `admin_org_ids` 非空

### 6.4 组件结构

```
src/
├── app/
│   ├── (auth)/login/           # 登录/注册页
│   └── (dashboard)/
│       ├── notebooks/          # 笔记本列表/详情
│       │   └── components/
│       │       ├── NotebookCard.tsx    # 组织关联弹框
│       │       └── NotebookDeleteDialog.tsx
│       ├── sources/            # 来源列表
│       └── admin/              # 管理后台
│           ├── layout.tsx      # 左侧菜单布局
│           ├── users/page.tsx  # 用户管理
│           └── organizations/page.tsx  # 组织管理
├── components/
│   └── layout/
│       └── AppSidebar.tsx      # 侧边栏（用户信息 + 组织展示）
└── lib/
    ├── stores/auth-store.ts
    └── api/organizations.ts
```

---

## 7. 关键问题与解决方案

### 7.1 Radix UI 弹框关闭后点击失效

**问题**：从 DropdownMenuItem 打开 Dialog，Dialog 关闭时 Radix 尝试将焦点还原到已卸载的 DropdownMenuItem，导致指针事件锁定。

**解决**：
```tsx
<DialogContent onCloseAutoFocus={e => e.preventDefault()}>
```
同时对 DropdownMenu 触发器延迟 50ms 后再打开 Dialog：
```typescript
setTimeout(() => setShowOrgDialog(true), 50)
```

### 7.2 SurrealDB 子查询 SELECT id vs SELECT VALUE id

**问题**：`WHERE out IN (SELECT id FROM notebook)` 返回对象数组 `[{id: ...}]`，与 RecordID 类型不匹配，导致 IN 查询始终为空。

**解决**：改为 `SELECT VALUE id` 返回值数组 `[notebook:xxx]`。

### 7.3 Source 双重 `_prepare_save_data` 覆盖

**问题**：`Source` 类中定义了两个同名方法，Python 只保留最后一个，导致 `user_id`/`org_id` 未被转换为 RecordID。

**解决**：合并为一个方法，同时处理 `org_id`、`user_id`、`command` 三个字段。

### 7.4 command 字段类型不匹配

**问题**：`CommandService.submit_command_job()` 返回 `RecordID` 对象，赋值给 `Optional[str]` 字段后 Pydantic strict 验证失败。

**解决**：赋值时使用 `str(command_id)` 转换；`_prepare_save_data` 保证写库时转回 RecordID。
