import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import envs from '../config/environment-vars';
import { ReturnType, TBootstrap } from './bootstrap.type';

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_requests (
      id INTEGER PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      document_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      failure_reason TEXT,
      failure_attempts INTEGER
    );
  `);

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(card_requests)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );

  if (!existingColumns.has('failure_reason')) {
    db.exec('ALTER TABLE card_requests ADD COLUMN failure_reason TEXT');
  }
  if (!existingColumns.has('failure_attempts')) {
    db.exec('ALTER TABLE card_requests ADD COLUMN failure_attempts INTEGER');
  }
}

export function openCardRequestsDatabase(path: string): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export class DatabaseBootstrap implements TBootstrap {
  private static db: Database.Database;

  initialize(): ReturnType {
    try {
      DatabaseBootstrap.db = openCardRequestsDatabase(envs.sqliteDbPath);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  static get dataSource(): Database.Database {
    return DatabaseBootstrap.db;
  }

  close(): void {
    DatabaseBootstrap.db?.close();
  }
}
