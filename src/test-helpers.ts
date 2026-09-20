import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Minimal in-memory D1 shim over node:sqlite.
 * Implements just enough of the D1 API (prepare/bind/first/all/run)
 * for unit tests. Not for production use.
 */
export function createTestDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('src/db/schema.sql', 'utf8'));

  const db = {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      const bound = (...params: SQLInputValue[]) => ({
        first: async <T>(): Promise<T | null> =>
          (stmt.get(...params) as T | undefined) ?? null,
        all: async <T>(): Promise<{ results: T[] }> => ({
          results: stmt.all(...params) as T[],
        }),
        run: async (): Promise<{ meta: { changes: number } }> => ({
          meta: { changes: Number(stmt.run(...params).changes) },
        }),
      });
      return {
        bind: bound,
        // Real D1 allows run/first/all without bind() when there are no params
        ...bound(),
      };
    },
  };
  return db as unknown as D1Database;
}
