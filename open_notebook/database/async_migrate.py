"""
Async migration system for SurrealDB using the official Python client.
Based on patterns from sblpy migration system.
"""

from typing import List

from loguru import logger

from .repository import db_connection, repo_query


class AsyncMigration:
    """
    Handles individual migration operations with async support.
    """

    def __init__(self, sql: str) -> None:
        """Initialize migration with SQL content."""
        self.sql = sql

    @classmethod
    def from_file(cls, file_path: str) -> "AsyncMigration":
        """Create migration from SQL file."""
        with open(file_path, "r", encoding="utf-8") as file:
            raw_content = file.read()
            # Clean up SQL content
            lines = []
            for line in raw_content.split("\n"):
                line = line.strip()
                if line and not line.startswith("--"):
                    lines.append(line)
            sql = " ".join(lines)
            return cls(sql)

    async def run(self, bump: bool = True) -> None:
        """Run the migration."""
        try:
            async with db_connection() as connection:
                await connection.query(self.sql)

            if bump:
                await bump_version()
            else:
                await lower_version()

        except Exception as e:
            logger.error(f"Migration failed: {str(e)}")
            raise


class AsyncMigrationRunner:
    """
    Handles running multiple migrations in sequence.
    """

    def __init__(
        self,
        up_migrations: List[AsyncMigration],
        down_migrations: List[AsyncMigration],
    ) -> None:
        """Initialize runner with migration lists."""
        self.up_migrations = up_migrations
        self.down_migrations = down_migrations

    async def run_all(self) -> None:
        """Run all pending up migrations."""
        current_version = await get_latest_version()

        for i in range(current_version, len(self.up_migrations)):
            logger.info(f"Running migration {i + 1}")
            await self.up_migrations[i].run(bump=True)

    async def run_one_up(self) -> None:
        """Run one up migration."""
        current_version = await get_latest_version()

        if current_version < len(self.up_migrations):
            logger.info(f"Running migration {current_version + 1}")
            await self.up_migrations[current_version].run(bump=True)

    async def run_one_down(self) -> None:
        """Run one down migration."""
        current_version = await get_latest_version()

        if current_version > 0:
            logger.info(f"Rolling back migration {current_version}")
            await self.down_migrations[current_version - 1].run(bump=False)


class AsyncMigrationManager:
    """
    Main migration manager with async support.
    """

    def __init__(self):
        """Initialize migration manager."""
        self.up_migrations = [
            AsyncMigration.from_file("open_notebook/database/migrations/1.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/2.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/3.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/4.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/5.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/6.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/7.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/8.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/9.surrealql"),
            AsyncMigration.from_file("open_notebook/database/migrations/10.surrealql"),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/11.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/12.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/13.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/14.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/15.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/16.surrealql"
            ),
        ]
        self.down_migrations = [
            AsyncMigration.from_file(
                "open_notebook/database/migrations/1_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/2_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/3_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/4_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/5_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/6_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/7_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/8_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/9_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/10_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/11_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/12_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/13_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/14_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/15_down.surrealql"
            ),
            AsyncMigration.from_file(
                "open_notebook/database/migrations/16_down.surrealql"
            ),
        ]
        self.runner = AsyncMigrationRunner(
            up_migrations=self.up_migrations,
            down_migrations=self.down_migrations,
        )

    async def get_current_version(self) -> int:
        """Get current database version."""
        return await get_latest_version()

    async def needs_migration(self) -> bool:
        """Check if migration is needed."""
        current_version = await self.get_current_version()
        return current_version < len(self.up_migrations)

    async def run_migration_up(self):
        """Run all pending migrations."""
        current_version = await self.get_current_version()
        logger.info(f"Current version before migration: {current_version}")

        if await self.needs_migration():
            try:
                await self.runner.run_all()
                new_version = await self.get_current_version()
                logger.info(f"Migration successful. New version: {new_version}")
                if new_version >= 15:
                    await self._migrate_org_memberships()
                    await self._migrate_notebook_org_ids()
                    await self._ensure_public_org()
            except Exception as e:
                logger.error(f"Migration failed: {str(e)}")
                raise
        else:
            logger.info("Database is already at the latest version")

    async def _migrate_org_memberships(self):
        """Migrate existing app_user.org_id to member_of records."""
        from .repository import ensure_record_id
        try:
            users_with_org = await repo_query(
                "SELECT id, org_id FROM app_user WHERE org_id IS NOT NONE AND org_id IS NOT NULL"
            )
            if not users_with_org:
                logger.info("No users with org_id to migrate to member_of")
                return

            migrated = 0
            for u in users_with_org:
                uid = ensure_record_id(str(u["id"]))
                oid = ensure_record_id(str(u["org_id"]))
                existing = await repo_query(
                    "SELECT * FROM member_of WHERE in = $uid AND out = $oid LIMIT 1",
                    {"uid": uid, "oid": oid},
                )
                if not existing:
                    await repo_query(
                        "CREATE member_of SET in = $uid, out = $oid, role = 'member'",
                        {"uid": uid, "oid": oid},
                    )
                    migrated += 1
            logger.info(f"Migrated {migrated} user-org relationships to member_of")
        except Exception as e:
            logger.warning(f"Non-critical: org membership migration failed: {e}")

    async def _migrate_notebook_org_ids(self):
        """Migrate existing notebook.org_id to org_ids array."""
        from .repository import ensure_record_id
        try:
            notebooks_with_org = await repo_query(
                "SELECT id, org_id FROM notebook WHERE org_id IS NOT NONE AND org_id IS NOT NULL AND (org_ids IS NONE OR org_ids IS NULL OR array::len(org_ids) = 0)"
            )
            if not notebooks_with_org:
                logger.info("No notebooks with single org_id to migrate to org_ids")
                return

            migrated = 0
            for nb in notebooks_with_org:
                nb_id = ensure_record_id(str(nb["id"]))
                org_rid = ensure_record_id(str(nb["org_id"]))
                await repo_query(
                    "UPDATE $nb_id SET org_ids = [$org_rid]",
                    {"nb_id": nb_id, "org_rid": org_rid},
                )
                migrated += 1
            logger.info(f"Migrated {migrated} notebooks from org_id to org_ids")
        except Exception as e:
            logger.warning(f"Non-critical: notebook org_ids migration failed: {e}")

    async def _ensure_public_org(self):
        """Create the system public organization (公开) if it does not exist.
        Also rename legacy '公开组' to '公开' if the old name is found."""
        name = "公开"
        legacy_name = "公开组"
        desc = "系统默认公开组，所有用户均可见，不可删除"
        try:
            # Rename legacy name if present
            await repo_query(
                "UPDATE organization SET name = $new WHERE name = $old",
                {"new": name, "old": legacy_name},
            )
            existing = await repo_query(
                "SELECT * FROM organization WHERE name = $name LIMIT 1",
                {"name": name},
            )
            if existing:
                logger.info("Public org (公开) already exists")
                return
            await repo_query(
                "CREATE organization CONTENT { name: $name, description: $desc }",
                {"name": name, "desc": desc},
            )
            logger.info("Created public org (公开)")
        except Exception as e:
            logger.warning(f"Non-critical: public org creation failed: {e}")


# Database version management functions
async def get_latest_version() -> int:
    """Get the latest version from the migrations table."""
    try:
        versions = await get_all_versions()
        if not versions:
            return 0
        return max(version["version"] for version in versions)
    except Exception:
        # If migrations table doesn't exist, we're at version 0
        return 0


async def get_all_versions() -> List[dict]:
    """Get all versions from the migrations table."""
    try:
        result = await repo_query("SELECT * FROM _sbl_migrations ORDER BY version;")
        return result
    except Exception:
        # If table doesn't exist, return empty list
        return []


async def bump_version() -> None:
    """Bump the version by adding a new entry to migrations table."""
    current_version = await get_latest_version()
    new_version = current_version + 1

    await repo_query(
        f"CREATE _sbl_migrations:{new_version} SET version = {new_version}, applied_at = time::now();",
    )


async def lower_version() -> None:
    """Lower the version by removing the latest entry from migrations table."""
    current_version = await get_latest_version()
    if current_version > 0:
        await repo_query(f"DELETE _sbl_migrations:{current_version};")
