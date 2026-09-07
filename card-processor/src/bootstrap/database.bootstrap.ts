import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import envs from '../config/environment-vars';
import { ReturnType, TBootstrap } from './bootstrap.type';

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_issuances (
      id INTEGER PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      document_number TEXT NOT NULL,
      card_number TEXT,
      card_expiry TEXT,
      card_cvv TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function openCardIssuancesDatabase(path: string): Database.Database {
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
      DatabaseBootstrap.db = openCardIssuancesDatabase(envs.sqliteDbPath);
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
