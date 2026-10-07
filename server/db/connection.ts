import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export type DB = DatabaseSync;

export function openDb(path = ':memory:'): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 8000');          // conexões concorrentes esperam em vez de falhar
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}

const depth = new WeakMap<DB, number>();

/**
 * Transação com BEGIN IMMEDIATE: obtém o lock de escrita ANTES de ler a disponibilidade.
 * Assim, "verificar estoque" + "gravar reserva" são atômicos mesmo com várias conexões/processos.
 * (Em PostgreSQL o equivalente é: BEGIN + SELECT ... FROM inventory WHERE ... FOR UPDATE.)
 */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();                          // já dentro de uma transação
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já revertida */ }
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
