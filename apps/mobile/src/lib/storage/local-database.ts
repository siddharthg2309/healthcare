import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { SyncOperation } from "@healthcare/contracts";

const databaseName = "healthcare.db";
const keyName = "healthcare.sqlite.key.v1";
const currentSchemaVersion = 1;

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabaseKey(): Promise<string> {
  const existingKey = await SecureStore.getItemAsync(keyName);
  if (existingKey) {
    if (!/^[a-f0-9]{64}$/.test(existingKey)) {
      throw new Error("The local database key is invalid. Sign out and reinstall the app to reset local storage.");
    }
    return existingKey;
  }

  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(keyName, key);
  return key;
}

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const version = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = version?.user_version ?? 0;

  if (currentVersion > currentSchemaVersion) {
    throw new Error("The local health database was created by a newer app version.");
  }
  if (currentVersion === currentSchemaVersion) return;

  await database.withTransactionAsync(async () => {
    if (currentVersion === 0) {
      await database.execAsync(`
        CREATE TABLE active_account (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          user_id TEXT NOT NULL,
          switched_at TEXT NOT NULL
        );
        CREATE TABLE local_records (
          owner_user_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          record_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          payload_json TEXT,
          deleted INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_user_id, entity, record_id)
        );
        CREATE TABLE sync_cursors (
          owner_user_id TEXT PRIMARY KEY,
          cursor INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sync_outbox (
          operation_id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          entity TEXT NOT NULL,
          record_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          operation_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE (owner_user_id, idempotency_key)
        );
        CREATE INDEX local_records_owner_updated_idx ON local_records(owner_user_id, updated_at);
        CREATE INDEX sync_outbox_owner_status_idx ON sync_outbox(owner_user_id, status, created_at);
      `);
      await database.execAsync(`PRAGMA user_version = ${currentSchemaVersion};`);
    }
  });
}

async function initialiseDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await getDatabaseKey();
  const database = await SQLite.openDatabaseAsync(databaseName);
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Could not create a valid local database key.");
  await database.execAsync(`PRAGMA key = '${key}';`);
  await migrate(database);
  return database;
}

export function openLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initialiseDatabase().catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

async function assertActiveAccount(database: SQLite.SQLiteDatabase, userId: string): Promise<void> {
  const activeAccount = await database.getFirstAsync<{ user_id: string }>(
    "SELECT user_id FROM active_account WHERE singleton_id = 1",
  );
  if (activeAccount?.user_id !== userId) {
    throw new Error("Local data is not active for this account.");
  }
}

export async function activateLocalAccount(
  database: SQLite.SQLiteDatabase,
  userId: string,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const current = await transaction.getFirstAsync<{ user_id: string }>(
      "SELECT user_id FROM active_account WHERE singleton_id = 1",
    );
    if (current?.user_id === userId) return;

    const pending = await transaction.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_outbox",
    );
    if ((pending?.count ?? 0) > 0) {
      throw new Error("Sync pending changes before switching accounts.");
    }

    await transaction.execAsync("DELETE FROM local_records; DELETE FROM sync_cursors; DELETE FROM sync_outbox;");
    await transaction.runAsync(
      `INSERT INTO active_account (singleton_id, user_id, switched_at)
       VALUES (1, ?, ?) ON CONFLICT(singleton_id) DO UPDATE SET user_id = excluded.user_id, switched_at = excluded.switched_at`,
      userId,
      new Date().toISOString(),
    );
  });
}

export async function deactivateLocalAccount(
  database: SQLite.SQLiteDatabase,
  userId: string,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    const pending = await transaction.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_outbox WHERE owner_user_id = ?",
      userId,
    );
    if ((pending?.count ?? 0) > 0) throw new Error("Sync pending changes before signing out.");

    await transaction.runAsync("DELETE FROM local_records WHERE owner_user_id = ?", userId);
    await transaction.runAsync("DELETE FROM sync_cursors WHERE owner_user_id = ?", userId);
    await transaction.runAsync("DELETE FROM sync_outbox WHERE owner_user_id = ?", userId);
    await transaction.runAsync("DELETE FROM active_account WHERE singleton_id = 1 AND user_id = ?", userId);
  });
}

export async function enqueueMutation(
  database: SQLite.SQLiteDatabase,
  userId: string,
  operationId: string,
  idempotencyKey: string,
  operation: SyncOperation,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    await transaction.runAsync(
      `INSERT INTO sync_outbox (
         operation_id, owner_user_id, entity, record_id, idempotency_key, operation_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING`,
      operationId,
      userId,
      operation.entity,
      operation.id,
      idempotencyKey,
      JSON.stringify(operation),
      new Date().toISOString(),
    );
  });
}

export async function listPendingMutations(
  database: SQLite.SQLiteDatabase,
  userId: string,
  limit = 100,
) {
  let mutations: {
    operation_id: string;
    idempotency_key: string;
    operation_json: string;
    attempts: number;
  }[] = [];
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    mutations = await transaction.getAllAsync<{
      operation_id: string;
      idempotency_key: string;
      operation_json: string;
      attempts: number;
    }>(
      `SELECT operation_id, idempotency_key, operation_json, attempts
       FROM sync_outbox WHERE owner_user_id = ? AND status = 'pending'
       ORDER BY created_at LIMIT ?`,
      userId,
      Math.max(1, Math.min(100, Math.floor(limit))),
    );
  });
  return mutations;
}

export async function markMutationSynced(
  database: SQLite.SQLiteDatabase,
  userId: string,
  operationId: string,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    await transaction.runAsync(
      "DELETE FROM sync_outbox WHERE owner_user_id = ? AND operation_id = ?",
      userId,
      operationId,
    );
  });
}

export async function listLocalRecords(
  database: SQLite.SQLiteDatabase,
  userId: string,
  entity: string,
) {
  let records: {
    record_id: string;
    version: number;
    payload_json: string | null;
    deleted: number;
    updated_at: string;
  }[] = [];
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    records = await transaction.getAllAsync<{
      record_id: string;
      version: number;
      payload_json: string | null;
      deleted: number;
      updated_at: string;
    }>(
      `SELECT record_id, version, payload_json, deleted, updated_at
       FROM local_records WHERE owner_user_id = ? AND entity = ? ORDER BY updated_at DESC`,
      userId,
      entity,
    );
  });
  return records;
}

export async function storePulledChanges(
  database: SQLite.SQLiteDatabase,
  userId: string,
  changes: {
    entity: string;
    recordId: string;
    version: number;
    data: Record<string, unknown> | null;
    deleted: boolean;
    cursor: number;
  }[],
  nextCursor: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertActiveAccount(transaction, userId);
    for (const change of changes) {
      await transaction.runAsync(
        `INSERT INTO local_records (
           owner_user_id, entity, record_id, version, payload_json, deleted, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_user_id, entity, record_id) DO UPDATE SET
           version = excluded.version, payload_json = excluded.payload_json,
           deleted = excluded.deleted, updated_at = excluded.updated_at`,
        userId,
        change.entity,
        change.recordId,
        change.version,
        change.data ? JSON.stringify(change.data) : null,
        change.deleted ? 1 : 0,
        new Date().toISOString(),
      );
    }
    await transaction.runAsync(
      `INSERT INTO sync_cursors (owner_user_id, cursor) VALUES (?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET cursor = excluded.cursor`,
      userId,
      nextCursor,
    );
  });
}
