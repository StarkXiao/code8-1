#!/usr/bin/env node
/**
 * 数据库迁移执行器。
 *
 * 为什么自己写：本项目的迁移 SQL 由 `prisma migrate diff` 从 schema.prisma 生成
 * （保证 DDL 与模型永不漂移），但执行环节使用 Node 内置的 node:sqlite，
 * 因此不需要 Prisma schema engine，也不需要任何原生编译依赖。
 *
 * 兼容性：写入的是 Prisma 标准的 `_prisma_migrations` 表结构，
 * 因此日后若要用 `prisma migrate deploy` 接管，历史记录仍然可识别。
 *
 * 用法：
 *   node scripts/migrate.mjs            # 应用全部待执行迁移
 *   node scripts/migrate.mjs --status   # 只查看状态
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { serverRoot, loadRootEnv, resolveSqliteFile, ensureDir } from './env.mjs';

loadRootEnv();

const MIGRATIONS_DIR = path.join(serverRoot, 'prisma', 'migrations');
const statusOnly = process.argv.includes('--status');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = path.join(MIGRATIONS_DIR, name, 'migration.sql');
      if (!fs.existsSync(file)) fail(`迁移 ${name} 缺少 migration.sql`);
      const sql = fs.readFileSync(file, 'utf8');
      return {
        name,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function openDatabase() {
  const dbFile = resolveSqliteFile();
  if (!dbFile) {
    fail(
      'DATABASE_URL 不是 SQLite（file:...）。\n' +
        '  非 SQLite 数据库请使用: npm --workspace @froa/server run db:push\n' +
        '  或参考 README「切换到 PostgreSQL」一节。',
    );
  }
  ensureDir(path.dirname(dbFile));
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return { db, dbFile };
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                  TEXT PRIMARY KEY NOT NULL,
      "checksum"            TEXT NOT NULL,
      "finished_at"         DATETIME,
      "migration_name"      TEXT NOT NULL,
      "logs"                TEXT,
      "rolled_back_at"      DATETIME,
      "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    );
  `);
}

function appliedMigrations(db) {
  const rows = db
    .prepare(
      `SELECT "migration_name", "checksum" FROM "_prisma_migrations"
       WHERE "rolled_back_at" IS NULL AND "finished_at" IS NOT NULL
       ORDER BY "started_at" ASC`,
    )
    .all();
  return new Map(rows.map((row) => [String(row.migration_name), String(row.checksum)]));
}

function main() {
  const migrations = listMigrations();
  const { db, dbFile } = openDatabase();
  ensureMigrationTable(db);

  const applied = appliedMigrations(db);
  const pending = migrations.filter((migration) => !applied.has(migration.name));

  // 校验已应用迁移的完整性：SQL 被改动过必须报错，否则后续迁移会基于错误前提
  const drifted = migrations.filter(
    (migration) => applied.has(migration.name) && applied.get(migration.name) !== migration.checksum,
  );
  if (drifted.length) {
    db.close();
    fail(
      `以下迁移文件在应用之后被修改过，校验和不一致：\n  ${drifted
        .map((m) => m.name)
        .join('\n  ')}\n\n迁移文件一经应用不可修改，请新增迁移文件。`,
    );
  }

  console.log(`数据库文件：${dbFile}`);
  console.log(`已应用：${applied.size} 个，待执行：${pending.length} 个`);

  if (statusOnly) {
    for (const migration of migrations) {
      const done = applied.has(migration.name);
      console.log(`  ${done ? '✔' : '·'} ${migration.name}${done ? '' : '   (待执行)'}`);
    }
    db.close();
    return;
  }

  if (!pending.length) {
    console.log('数据库已是最新状态，无需迁移。\n');
    db.close();
    return;
  }

  for (const migration of pending) {
    const id = crypto.randomUUID();
    process.stdout.write(`  → 正在应用 ${migration.name} ... `);
    try {
      db.exec('BEGIN IMMEDIATE;');
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO "_prisma_migrations"
           ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
         VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)`,
      ).run(id, migration.checksum, migration.name);
      db.exec('COMMIT;');
      console.log('完成');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      db.close();
      fail(`迁移 ${migration.name} 执行失败：${error?.message ?? error}`);
    }
  }

  db.close();
  console.log('\n✔ 迁移完成。\n');
}

main();
