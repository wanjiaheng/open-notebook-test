# 数据库变更说明文档

> **项目**：Open Notebook  
> **数据库**：SurrealDB v2  
> **迁移执行时机**：API 启动时（`lifespan`）自动执行 pending 迁移  
> **版本**：v1.0  
> **日期**：2026-03-15  

---

## 1. 迁移总览

| 版本 | 文件 | 变更描述 |
|------|------|----------|
| 1 | `1.surrealql` | 核心表：source, source_embedding, source_insight, note, notebook；全文/向量搜索函数 |
| 2 | `2.surrealql` | note 表添加 note_type |
| 3 | `3.surrealql` | chat_session 表；refers_to 关系；重写 fn::vector_search 增加 $min_similarity |
| 4 | `4.surrealql` | 重写 fn::text_search / fn::vector_search，统一返回结构 |
| 5 | `5.surrealql` | transformation 表及默认转换模板；default_prompts 单例 |
| 6 | `6.surrealql` | 统一 provider 命名 vertexai → vertex |
| 7 | `7.surrealql` | episode_profile, speaker_profile 播客表 |
| 8 | `8.surrealql` | refers_to 支持 notebook\|source；chat_session.model_override；source.command |
| 9 | `9.surrealql` | 重写 fn::vector_search 优化向量搜索 |
| 10 | `10.surrealql` | source_insight/source_embedding 索引；embedding 可选；清理孤儿记录 |
| 11 | `11.surrealql` | open_notebook:provider_configs 单例 |
| 12 | `12.surrealql` | credential 表；model.credential 关联 |
| 13 | `13.surrealql` | source_insight/note 的 embedding 改为 option |
| 14 | `14.surrealql` | episode_profile/speaker_profile 接入 Model 注册表 |
| 15 | `15.surrealql` | **汇总**：organization, app_user, member_of, notebook/source 扩展字段, audit_log |
| 16 | `16.surrealql` | **兼容补全**：对旧版 15 补充 member_of, user_id, org_ids, audit_log（幂等） |

---

## 2. 各迁移脚本（带注释）

### Migration 1：核心表结构

```sql
-- Migration 1: 核心表结构初始化
-- 创建 source, source_embedding, source_insight, note, notebook 表
-- 定义 reference (source->notebook), artifact (note->notebook) 关系
-- 创建全文搜索分析器、索引及 fn::text_search / fn::vector_search 函数
-- 初始化 open_notebook:default_models 单例

DEFINE TABLE IF NOT EXISTS source SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS asset ON TABLE source FLEXIBLE TYPE option<object>;
DEFINE FIELD IF NOT EXISTS title ON TABLE source TYPE option<string>;
DEFINE FIELD IF NOT EXISTS topics ON TABLE source TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS full_text ON TABLE source TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created ON source DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON source DEFAULT time::now() VALUE time::now();

DEFINE TABLE IF NOT EXISTS source_embedding SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS source ON TABLE source_embedding TYPE record<source>;
DEFINE FIELD IF NOT EXISTS order ON TABLE source_embedding TYPE int;
DEFINE FIELD IF NOT EXISTS content ON TABLE source_embedding TYPE string;
DEFINE FIELD IF NOT EXISTS embedding ON TABLE source_embedding TYPE array<float>;

DEFINE TABLE IF NOT EXISTS source_insight SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS source ON TABLE source_insight TYPE record<source>;
DEFINE FIELD IF NOT EXISTS insight_type ON TABLE source_insight TYPE string;
DEFINE FIELD IF NOT EXISTS content ON TABLE source_insight TYPE string;
DEFINE FIELD IF NOT EXISTS embedding ON TABLE source_insight TYPE array<float>;

DEFINE EVENT IF NOT EXISTS source_delete ON TABLE source WHEN ($after == NONE) THEN {
    delete source_embedding where source == $before.id;
    delete source_insight where source == $before.id;
};

DEFINE TABLE IF NOT EXISTS note SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS title ON TABLE note TYPE option<string>;
DEFINE FIELD IF NOT EXISTS summary ON TABLE note TYPE option<string>;
DEFINE FIELD IF NOT EXISTS content ON TABLE note TYPE option<string>;
DEFINE FIELD IF NOT EXISTS embedding ON TABLE note TYPE array<float>;
DEFINE FIELD IF NOT EXISTS created ON note DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON note DEFAULT time::now() VALUE time::now();

DEFINE TABLE IF NOT EXISTS notebook SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON TABLE notebook TYPE option<string>;
DEFINE FIELD IF NOT EXISTS description ON TABLE notebook TYPE option<string>;
DEFINE FIELD IF NOT EXISTS archived ON TABLE notebook TYPE option<bool> DEFAULT False;
DEFINE FIELD IF NOT EXISTS created ON notebook DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON notebook DEFAULT time::now() VALUE time::now();

DEFINE TABLE IF NOT EXISTS reference TYPE RELATION FROM source TO notebook;
DEFINE TABLE IF NOT EXISTS artifact TYPE RELATION FROM note TO notebook;

DEFINE ANALYZER IF NOT EXISTS my_analyzer TOKENIZERS blank,class,camel,punct FILTERS snowball(english), lowercase;
DEFINE INDEX IF NOT EXISTS idx_source_title ON TABLE source COLUMNS title SEARCH ANALYZER my_analyzer BM25 HIGHLIGHTS;
DEFINE INDEX IF NOT EXISTS idx_source_full_text ON TABLE source COLUMNS full_text SEARCH ANALYZER my_analyzer BM25 HIGHLIGHTS;
-- ... fn::text_search, fn::vector_search 函数定义 ...
-- ... 初始化 open_notebook:default_models ...
```

---

### Migration 2：note_type

```sql
-- Migration 2: 为 note 表添加 note_type 字段
DEFINE FIELD IF NOT EXISTS note_type ON TABLE note TYPE option<string>;
```

---

### Migration 3：chat_session

```sql
-- Migration 3: 创建 chat_session 表及 refers_to 关系
-- 重写 fn::vector_search 增加 $min_similarity 参数
-- 重写 fn::text_search 返回结构统一为 id, parent_id, title, relevance

DEFINE TABLE IF NOT EXISTS chat_session SCHEMALESS;
DEFINE TABLE IF NOT EXISTS refers_to TYPE RELATION FROM chat_session TO notebook;
REMOVE FUNCTION IF EXISTS fn::vector_search;
-- ... fn::vector_search 新定义 ...
REMOVE FUNCTION IF EXISTS fn::text_search;
-- ... fn::text_search 新定义 ...
```

---

### Migration 4：搜索函数重写

```sql
-- Migration 4: 重写 fn::text_search / fn::vector_search
-- 修复 source_insight 空 title 处理，统一返回 id, parent_id, title, relevance/similarity
```

---

### Migration 5：transformation

```sql
-- Migration 5: 创建 transformation 表及默认转换模板
-- 删除旧 default_transformations，插入 Analyze Paper / Key Insights / Dense Summary 等
-- 初始化 open_notebook:default_prompts 单例

DELETE open_notebook:default_transformations;
DEFINE TABLE IF NOT EXISTS transformation SCHEMAFULL;
-- ... 字段定义 ...
INSERT INTO transformation [ ... ];
UPSERT open_notebook:default_prompts CONTENT { transformation_instructions: "..." };
```

---

### Migration 6：provider 命名

```sql
-- Migration 6: 统一 provider 命名 vertexai -> vertex
update model set provider='vertex' where provider='vertexai';
```

---

### Migration 7：播客表

```sql
-- Migration 7: 创建播客相关表 episode_profile, speaker_profile
-- 定义 outline/transcript 的 provider/model 字段及 speaker 配置

DEFINE TABLE IF NOT EXISTS episode_profile SCHEMAFULL;
-- ... 字段定义 ...
DEFINE TABLE IF NOT EXISTS speaker_profile SCHEMAFULL;
-- ... 字段定义 ...
```

---

### Migration 8：chat_session 多目标

```sql
-- Migration 8: 支持 chat_session 关联 notebook 或 source
-- refers_to 改为 RELATION FROM chat_session TO notebook|source
-- 新增 chat_session.model_override、source.command 字段

DEFINE TABLE OVERWRITE refers_to TYPE RELATION FROM chat_session TO notebook|source;
DEFINE FIELD model_override ON chat_session TYPE option<string>;
DEFINE FIELD command ON source TYPE option<record<command>>;
```

---

### Migration 9：向量搜索优化

```sql
-- Migration 9: 重写 fn::vector_search
-- 优化向量搜索逻辑，统一返回结构
```

---

### Migration 10：索引与清理

```sql
-- Migration 10: Add indexes for source_insight and source_embedding source field
-- These indexes significantly improve performance of source listing queries

DEFINE INDEX IF NOT EXISTS idx_source_insight_source ON source_insight FIELDS source CONCURRENTLY;
DEFINE INDEX IF NOT EXISTS idx_source_embedding_source ON source_embedding FIELDS source CONCURRENTLY;
DEFINE FIELD OVERWRITE embedding ON TABLE source_insight TYPE option<array<float>>;
DEFINE FIELD OVERWRITE embedding ON TABLE note TYPE option<array<float>>;
DELETE from source_embedding WHERE source.id=NONE;
DELETE from source_insight WHERE source.id=NONE;
```

---

### Migration 11：provider_configs

```sql
-- Migration 11: Create provider configuration singleton record
UPSERT open_notebook:provider_configs CONTENT { credentials: {} };
```

---

### Migration 12：credential 表

```sql
-- Migration 12: Create credential table and add credential link to model table
DEFINE TABLE credential SCHEMAFULL;
DEFINE FIELD name ON credential TYPE string;
DEFINE FIELD provider ON credential TYPE string;
-- ... 其他字段 ...
DEFINE INDEX idx_credential_provider ON credential FIELDS provider;
DEFINE FIELD credential ON model TYPE option<record<credential>>;
```

---

### Migration 13：embedding 可选

```sql
-- Migration 13: 将 source_insight / note 的 embedding 字段改为可选
DEFINE FIELD OVERWRITE embedding ON TABLE source_insight TYPE option<array<float>>;
DEFINE FIELD OVERWRITE embedding ON TABLE note TYPE option<array<float>>;
```

---

### Migration 14：播客 Model 注册表

```sql
-- Migration 14: Podcast profiles model registry integration
-- Adds record<model> references to replace loose provider/model strings
-- Adds language field to episode_profile
-- Adds per-speaker TTS override support

DEFINE FIELD OVERWRITE outline_provider ON TABLE episode_profile TYPE option<string>;
DEFINE FIELD OVERWRITE outline_model ON TABLE episode_profile TYPE option<string>;
-- ... 更多字段 ...
DEFINE FIELD IF NOT EXISTS outline_llm ON TABLE episode_profile TYPE option<record<model>>;
DEFINE FIELD IF NOT EXISTS transcript_llm ON TABLE episode_profile TYPE option<record<model>>;
DEFINE FIELD IF NOT EXISTS language ON TABLE episode_profile TYPE option<string>;
-- ... speaker_profile ...
```

---

### Migration 15：多租户 + 审计日志（汇总原 15–20）

```sql
-- 组织表、应用用户表、member_of 多对多关系
-- notebook/source 扩展：org_id, user_id, org_ids
-- audit_log 审计日志表
-- 详见 open_notebook/database/migrations/15.surrealql
```

**Python Post-Hook**（`new_version >= 15` 时执行）：
- `_migrate_org_memberships()`：将 app_user.org_id 迁移到 member_of
- `_migrate_notebook_org_ids()`：将 notebook.org_id 迁移到 org_ids
- `_ensure_public_org()`：创建/重命名「公开」组织

**回滚**：`15_down.surrealql` — 移除上述所有表及字段

---

### Migration 16：兼容补全（旧版 15 升级用）

对仅执行过旧版 15 的实例补充 member_of、user_id、org_ids、audit_log。若已执行汇总版 15，本迁移为幂等空操作。

**回滚**：`16_down.surrealql`

---

## 3. 多租户表结构全览（扩展后）

### `organization` 表

```
organization {
  id:          record<organization>   AUTO
  name:        string                 REQUIRED, 唯一
  description: option<string>
  created:     datetime               AUTO
  updated:     datetime               AUTO-UPDATE
}
```

### `app_user` 表

```
app_user {
  id:            record<app_user>       AUTO
  username:      string                 REQUIRED, 唯一
  email:         string                 REQUIRED, 唯一
  password_hash: string                 REQUIRED (bcrypt)
  role:          string                 DEFAULT 'user'   ('user'|'admin')
  status:        string                 DEFAULT 'pending' ('pending'|'active'|'suspended')
  org_id:        option<record<organization>>   已弃用
  created:       datetime               AUTO
  updated:       datetime               AUTO-UPDATE
}

索引：idx_app_user_email (email) UNIQUE, idx_app_user_username (username) UNIQUE
```

### `member_of` 图边表

```
member_of {
  in:      record<app_user>       REQUIRED
  out:     record<organization>   REQUIRED
  role:    string                 DEFAULT 'member'  ('member'|'org_admin')
  created: datetime               AUTO
}

索引：idx_member_of_unique (in, out) UNIQUE
```

### `audit_log` 表

```
audit_log {
  id:            record<audit_log>      AUTO
  operator_id:   option<record<app_user>>
  operator_name: string
  action:        string
  resource_type: string
  resource_id:   option<string>
  resource_name: option<string>
  detail:        option<string>
  ip:            option<string>
  created:       datetime               AUTO
}

索引：idx_audit_log_created, idx_audit_log_operator_id, idx_audit_log_action, idx_audit_log_resource
```

### `notebook` 表（扩展字段）

```
notebook {
  ...原有字段...
  org_id:   option<record<organization>>          已弃用（Migration 15）
  user_id:  option<record<app_user>>              Migration 16
  org_ids:  option<array<record<organization>>>   Migration 18 (主字段)
}
```

### `source` 表（扩展字段）

```
source {
  ...原有字段...
  org_id:  option<record<organization>>  Migration 15
  user_id: option<record<app_user>>      Migration 16
}
```

---

## 4. 数据迁移注意事项

1. **迁移顺序**：必须按版本号顺序执行（1 → 2 → ... → 20）
2. **幂等性**：所有 DDL 使用 `IF NOT EXISTS`，可安全重复执行
3. **存量数据**：Migration 16/18 新增字段允许 `NULL`，存量记录无需回填
4. **公开组织**：Migration 19 在 API 启动时自动执行，也在 `get_public_org_id()` 调用时透明补偿
5. **回滚风险**：Migration 17/18 回滚会丢失所有多对多关系和多组织关联数据，需提前备份

---

## 5. 常用运维查询

```sql
-- 查询所有组织
SELECT id, name FROM organization;

-- 查询某用户的组织关系
SELECT out.name, role FROM member_of WHERE in = app_user:xxxx;

-- 查询某组织的所有成员
SELECT in.username, in.email, role FROM member_of WHERE out = organization:xxxx;

-- 查询待审批用户
SELECT id, username, email, created FROM app_user WHERE status = 'pending';

-- 查询某用户可见的笔记本数量
SELECT count() FROM notebook
WHERE user_id = app_user:xxxx
   OR (org_ids IS NOT NONE AND array::intersect(org_ids, [organization:xxx]) != [])
GROUP ALL;

-- 查询最近审计日志
SELECT operator_name, action, resource_type, detail, created FROM audit_log ORDER BY created DESC LIMIT 50;
```
