/**
 * localMessageStore.ts
 *
 * Thin wrapper around expo-sqlite for storing chat messages locally on the device.
 * No message content ever touches the server — only signaling metadata (PendingDelivery)
 * is stored server-side.
 */

import * as SQLite from "expo-sqlite";
import { File, Paths } from 'expo-file-system';
import { partitionRemoteDigest, type MessageDigestEntry } from './syncDelta';

let _db: SQLite.SQLiteDatabase | null = null;
let _dbOpenPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let _initPromise: Promise<void> | null = null;
let _writeTail: Promise<void> = Promise.resolve();

const LOCAL_DB_SCHEMA_VERSION = 4;
const PROCESSED_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DELETED_MESSAGE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_PROCESSED_EVENTS = 50_000;
const MAX_CACHED_CALLS_PER_ACCOUNT = 1_000;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  // Startup launches several local-first readers at once (rooms, contacts,
  // calls, and chat history). Opening multiple handles to the same SQLite file
  // races their migrations and can surface as "database is locked".
  if (!_dbOpenPromise) {
    _dbOpenPromise = SQLite.openDatabaseAsync("axonic_messages.db").then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      _db = db;
      return db;
    });
  }
  return _dbOpenPromise;
}

/**
 * Cache replacement jobs use the same primary connection and global writer
 * queue as chat messages. Expo's exclusive transaction API opens a second
 * connection, which can remain blocked by ordinary writes on the primary
 * connection and fail while finalizing a prepared statement.
 */
function isBusyError(error: unknown): boolean {
  const detail = String((error as any)?.message ?? error ?? '').toLowerCase();
  return detail.includes('database is locked') || detail.includes('database_busy');
}

/**
 * Funnel every foreground writer through one queue and retry when Android's
 * headless FCM runtime briefly owns the same WAL.  Serializing only the cache
 * replacement transactions was not enough: a chat send could race one of
 * those jobs and lose its optimistic message while finalising the statement.
 */
function runSerializedWrite<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = _writeTail.then(async () => {
    const db = await getDB();
    let lastError: unknown = null;
    // A headless FCM/background task can briefly own SQLite from a separate JS
    // runtime, outside this module's in-process queue. Allow that short writer
    // to finish instead of dropping the authoritative cache refresh.
    for (const delayMs of [0, 100, 300, 700, 1_500, 3_000]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        return await task(db);
      } catch (error) {
        lastError = error;
        if (!isBusyError(error)) throw error;
      }
    }
    throw lastError;
  });
  _writeTail = run.then(() => {}, () => {});
  return run;
}

function runExclusiveWrite(task: (tx: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  return runSerializedWrite((db) => db.withTransactionAsync(() => task(db)));
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function initDB(): Promise<void> {
  // Schema setup and migrations must also be single-flight. Every caller gets
  // the same promise instead of executing competing ALTER/CREATE statements.
  if (!_initPromise) _initPromise = initDBOnce();
  return _initPromise;
}

async function initDBOnce(): Promise<void> {
  const db = await getDB();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT    PRIMARY KEY,
      room_id     TEXT    NOT NULL,
      sender_id   INTEGER NOT NULL,
      sender_name TEXT    NOT NULL,
      content     TEXT,
      type        TEXT    DEFAULT 'text',
      file_uri    TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT,
      revision    INTEGER DEFAULT 0,
      accepted_at TEXT,
      is_mine     INTEGER DEFAULT 0,
      sync        INTEGER DEFAULT 0,
      status      TEXT    DEFAULT 'pending',
      auto_retry_blocked INTEGER DEFAULT 0,
      transfer_error_code TEXT,
      transfer_error_message TEXT,
      reactions   TEXT    DEFAULT '{}',
      is_deleted  INTEGER DEFAULT 0,
      is_read     INTEGER DEFAULT 0,
      reply_to    TEXT,
      duration_ms INTEGER,
      media_ptr   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at);
    -- Axion emits a compact reconnect digest ordered by recency across rooms.
    -- This index keeps that work bounded even after a long-lived account has
    -- accumulated a large offline history.
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at DESC);

    CREATE TABLE IF NOT EXISTS delivery_tracking (
      message_id   TEXT    NOT NULL,
      recipient_id INTEGER NOT NULL,
      delivered    INTEGER DEFAULT 0,
      PRIMARY KEY (message_id, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_tracking_message ON delivery_tracking (message_id);

    CREATE TABLE IF NOT EXISTS update_outbox (
      id                 TEXT    PRIMARY KEY,
      room_id            TEXT    NOT NULL,
      message_id         TEXT    NOT NULL,
      changes            TEXT    NOT NULL,
      expected_peer_ids  TEXT    NOT NULL DEFAULT '[]',
      acked_by_user_ids  TEXT    NOT NULL DEFAULT '[]',
      created_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_update_outbox_room_created ON update_outbox (room_id, created_at);

    -- RRP: persistent idempotency ledger. Every inbound protocol event whose
    -- id has been fully processed is recorded here so the same event arriving
    -- over a second transport (or after a cold restart) is a no-op.
    CREATE TABLE IF NOT EXISTS processed_events (
      id   TEXT    PRIMARY KEY,
      type TEXT,
      ts   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_processed_events_ts ON processed_events (ts);

    -- Room metadata is separate from messages so the chat list can render
    -- instantly on app start, even while the network refresh is still running.
    -- The owner id prevents one account's room names/members leaking into a
    -- later account on the same device.
    CREATE TABLE IF NOT EXISTS room_cache (
      owner_user_id INTEGER NOT NULL,
      room_id       TEXT    NOT NULL,
      payload       TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL,
      cached_at     INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, room_id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_cache_owner_updated
      ON room_cache (owner_user_id, updated_at DESC);

    -- Durable, account-scoped contact/block state. This lets a message request
    -- render correctly before the contacts API refresh completes at startup.
    CREATE TABLE IF NOT EXISTS relationship_cache (
      owner_user_id INTEGER NOT NULL,
      other_user_id INTEGER NOT NULL,
      state         TEXT    NOT NULL CHECK(state IN ('contact', 'blocked')),
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, other_user_id)
    );

    -- Full contact rows back the people pickers (new chat, group, share) so
    -- they can render immediately instead of waiting for /contacts/.
    CREATE TABLE IF NOT EXISTS contact_cache (
      owner_user_id INTEGER NOT NULL,
      contact_id    INTEGER NOT NULL,
      payload       TEXT    NOT NULL,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contact_cache_owner_updated
      ON contact_cache (owner_user_id, updated_at DESC);

    -- Durable, account-scoped call history for the Calls tab's local-first UI.
    CREATE TABLE IF NOT EXISTS call_cache (
      owner_user_id INTEGER NOT NULL,
      call_id       TEXT    NOT NULL,
      payload       TEXT    NOT NULL,
      started_at    TEXT    NOT NULL,
      cached_at     INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, call_id)
    );
    CREATE INDEX IF NOT EXISTS idx_call_cache_owner_started
      ON call_cache (owner_user_id, started_at DESC);
  `);
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = Number(versionRow?.user_version ?? 0);

  if (currentVersion < 1) {
    await addColumnsIfMissing(db, 'messages', {
      reactions: `TEXT DEFAULT '{}'`,
      is_deleted: 'INTEGER DEFAULT 0',
      is_read: 'INTEGER DEFAULT 0',
      sync: 'INTEGER DEFAULT 0',
      status: `TEXT DEFAULT 'pending'`,
      reply_to: 'TEXT',
      duration_ms: 'INTEGER',
    });
  }

  if (currentVersion < 2) {
    await addColumnsIfMissing(db, 'messages', {
      media_ptr: 'TEXT',
      auto_retry_blocked: 'INTEGER DEFAULT 0',
      transfer_error_code: 'TEXT',
      transfer_error_message: 'TEXT',
    });
    await addColumnsIfMissing(db, 'update_outbox', {
      expected_peer_ids: `TEXT NOT NULL DEFAULT '[]'`,
      acked_by_user_ids: `TEXT NOT NULL DEFAULT '[]'`,
    });
  }

  if (currentVersion < 3) {
    await addColumnsIfMissing(db, 'messages', {
      updated_at: 'TEXT',
      revision: 'INTEGER DEFAULT 0',
      accepted_at: 'TEXT',
    });
    // Legacy rows used a boolean sync flag. Preserve their already-accepted
    // state once, then use acceptance timestamps and edit versions going forward.
    await db.execAsync(`
      UPDATE messages SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = '';
      UPDATE messages SET accepted_at = created_at WHERE accepted_at IS NULL AND sync = 1;
    `);
  }

  if (currentVersion < 4) {
    // Repair read receipts created before author-targeted routing existed. Those
    // rows waited for every group member and kept retrying whenever one member
    // stayed offline. Narrow the durable plan without deleting user data.
    const legacyReceipts = await db.getAllAsync<{
      id: string;
      changes: string;
      sender_id: number | null;
    }>(`
      SELECT o.id, o.changes, m.sender_id
      FROM update_outbox o
      LEFT JOIN messages m ON m.id = o.message_id
    `);
    for (const row of legacyReceipts) {
      let changes: MessageChanges;
      try { changes = JSON.parse(row.changes) as MessageChanges; } catch { continue; }
      const authorId = Number(row.sender_id ?? 0);
      if (changes.is_read !== true || changes.receipt_target_id || authorId <= 0) continue;
      changes.receipt_target_id = authorId;
      await db.runAsync(
        `UPDATE update_outbox SET changes = ?, expected_peer_ids = ? WHERE id = ?`,
        JSON.stringify(changes), JSON.stringify([authorId]), row.id,
      );
    }
  }

  if (currentVersion < LOCAL_DB_SCHEMA_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${LOCAL_DB_SCHEMA_VERSION}`);
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_updated ON messages (room_id, updated_at DESC);
  `);

  // Startup cleanup is deliberately metadata-first and bounded. It never
  // removes pending messages or active outbox work.
  await pruneLocalDataWithDb(db).catch((error) => {
    console.warn('[LocalDB] startup pruning failed:', error);
  });
}

async function addColumnsIfMissing(
  db: SQLite.SQLiteDatabase,
  table: 'messages' | 'update_outbox',
  columns: Record<string, string>,
): Promise<void> {
  const existing = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  const names = new Set(existing.map((column) => column.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!names.has(name)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

// ---------------------------------------------------------------------------
// Local room metadata cache (local-first chat list)
// ---------------------------------------------------------------------------

export async function getCachedRooms(ownerUserId: number): Promise<import('../types').ChatRoom[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM room_cache WHERE owner_user_id = ? ORDER BY updated_at DESC`,
    ownerUserId,
  );
  const rooms: import('../types').ChatRoom[] = [];
  for (const row of rows) {
    try {
      const room = JSON.parse(row.payload);
      if (room?.id && Array.isArray(room.members_detail)) rooms.push(room);
    } catch {
      // A corrupt/stale row is ignored and repaired by the next server sync.
    }
  }
  return rooms;
}

/** Replace this user's room metadata with the latest authoritative server list. */
export async function cacheRooms(ownerUserId: number, rooms: import('../types').ChatRoom[]): Promise<void> {
  const now = Date.now();
  await runExclusiveWrite(async (tx) => {
    await tx.runAsync(`DELETE FROM room_cache WHERE owner_user_id = ?`, ownerUserId);
    for (const room of rooms) {
      await tx.runAsync(
        `INSERT INTO room_cache (owner_user_id, room_id, payload, updated_at, cached_at)
         VALUES (?, ?, ?, ?, ?)`,
        ownerUserId,
        room.id,
        JSON.stringify(room),
        room.updated_at || new Date(now).toISOString(),
        now,
      );
    }
  });
}

export interface CachedRelationshipSets {
  contactIds: number[];
  blockedIds: number[];
}

export async function getCachedRelationshipSets(ownerUserId: number): Promise<CachedRelationshipSets> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ other_user_id: number; state: 'contact' | 'blocked' }>(
    `SELECT other_user_id, state FROM relationship_cache WHERE owner_user_id = ?`,
    ownerUserId,
  );
  return {
    contactIds: rows.filter((row) => row.state === 'contact').map((row) => row.other_user_id),
    blockedIds: rows.filter((row) => row.state === 'blocked').map((row) => row.other_user_id),
  };
}

/** Replace relationship state after a successful authoritative API sync. */
export async function cacheRelationshipSets(ownerUserId: number, contactIds: number[], blockedIds: number[]): Promise<void> {
  const now = Date.now();
  await runExclusiveWrite(async (tx) => {
    await tx.runAsync(`DELETE FROM relationship_cache WHERE owner_user_id = ?`, ownerUserId);
    for (const otherUserId of contactIds) {
      await tx.runAsync(`INSERT INTO relationship_cache (owner_user_id, other_user_id, state, updated_at) VALUES (?, ?, 'contact', ?)`, ownerUserId, otherUserId, now);
    }
    for (const otherUserId of blockedIds) {
      await tx.runAsync(`INSERT INTO relationship_cache (owner_user_id, other_user_id, state, updated_at) VALUES (?, ?, 'blocked', ?)`, ownerUserId, otherUserId, now);
    }
  });
}

// ---------------------------------------------------------------------------
// Local contact cache (instant people pickers)
// ---------------------------------------------------------------------------

export async function getCachedContacts(ownerUserId: number): Promise<import('../types').Contact[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM contact_cache WHERE owner_user_id = ? ORDER BY updated_at DESC`,
    ownerUserId,
  );
  const contacts: import('../types').Contact[] = [];
  for (const row of rows) {
    try {
      const contact = JSON.parse(row.payload);
      if (contact?.contact && contact?.contact_detail?.id) contacts.push(contact);
    } catch {
      // Corrupt cache rows are ignored and repaired by the next refresh.
    }
  }
  return contacts;
}

export async function cacheContacts(ownerUserId: number, contacts: import('../types').Contact[]): Promise<void> {
  const now = Date.now();
  await runExclusiveWrite(async (tx) => {
    await tx.runAsync(`DELETE FROM contact_cache WHERE owner_user_id = ?`, ownerUserId);
    for (const contact of contacts) {
      await tx.runAsync(
        `INSERT INTO contact_cache (owner_user_id, contact_id, payload, updated_at) VALUES (?, ?, ?, ?)`,
        ownerUserId,
        contact.contact,
        JSON.stringify(contact),
        now,
      );
    }
  });
}

/** Save acceptance and picker metadata together without replacing other contacts. */
export async function cacheAcceptedContact(ownerUserId: number, contact: import('../types').Contact): Promise<void> {
  const now = Date.now();
  await runExclusiveWrite(async (tx) => {
    await tx.runAsync(
      `INSERT INTO contact_cache (owner_user_id, contact_id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_user_id, contact_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      ownerUserId, contact.contact, JSON.stringify(contact), now,
    );
    await tx.runAsync(
      `INSERT INTO relationship_cache (owner_user_id, other_user_id, state, updated_at) VALUES (?, ?, 'contact', ?)
       ON CONFLICT(owner_user_id, other_user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      ownerUserId, contact.contact, now,
    );
  });
}

/** Optimistically record an accepted contact or blocked sender immediately. */
export async function setCachedRelationship(ownerUserId: number, otherUserId: number, state: 'contact' | 'blocked' | null): Promise<void> {
  // This can be triggered while the foreground relationship refresh is
  // replacing the full cache. Keep it on the same serialized writer lane so a
  // quick accept/block action is not lost or rejected as "database is locked".
  await runExclusiveWrite(async (tx) => {
    if (state == null) {
      await tx.runAsync(`DELETE FROM relationship_cache WHERE owner_user_id = ? AND other_user_id = ?`, ownerUserId, otherUserId);
      return;
    }
    await tx.runAsync(
      `INSERT INTO relationship_cache (owner_user_id, other_user_id, state, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_user_id, other_user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      ownerUserId, otherUserId, state, Date.now(),
    );
  });
}

export async function getCachedCallHistory(ownerUserId: number): Promise<import('../types').CallLog[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM call_cache WHERE owner_user_id = ? ORDER BY started_at DESC`,
    ownerUserId,
  );
  const calls: import('../types').CallLog[] = [];
  for (const row of rows) {
    try {
      const call = JSON.parse(row.payload);
      if (call?.id && call?.started_at) calls.push(call);
    } catch { /* repaired by next successful server sync */ }
  }
  return calls;
}

export async function cacheCallHistory(ownerUserId: number, calls: import('../types').CallLog[]): Promise<void> {
  const now = Date.now();
  await runExclusiveWrite(async (tx) => {
    await tx.runAsync(`DELETE FROM call_cache WHERE owner_user_id = ?`, ownerUserId);
    for (const call of calls) {
      await tx.runAsync(
        `INSERT INTO call_cache (owner_user_id, call_id, payload, started_at, cached_at) VALUES (?, ?, ?, ?, ?)`,
        ownerUserId, call.id, JSON.stringify(call), call.started_at, now,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// On-device storage inspection
// ---------------------------------------------------------------------------

export interface LocalChatStorageRoom {
  roomId: string;
  messageCount: number;
  /** SQLite row payload attributable to this room (text, metadata, pointers). */
  databaseBytes: number;
  /** Downloaded/recorded media files referenced by this room. */
  mediaBytes: number;
  totalBytes: number;
}

export interface LocalChatStorageStats {
  /** Allocated SQLite database pages, including indexes and all local tables. */
  databaseBytes: number;
  /** Physical media files referenced by locally stored messages. */
  mediaBytes: number;
  totalBytes: number;
  rooms: LocalChatStorageRoom[];
}

/**
 * Calculate the chat data stored on this device. SQLite does not expose a
 * precise per-table file allocation because pages and indexes are shared, so
 * the total uses the actual database page count while each room is based on
 * its stored row payload plus the exact size of its local media files.
 */
export async function getLocalChatStorageStats(): Promise<LocalChatStorageStats> {
  const db = await getDB();
  const [pageCount, pageSize] = await Promise.all([
    db.getFirstAsync<{ page_count: number }>('PRAGMA page_count'),
    db.getFirstAsync<{ page_size: number }>('PRAGMA page_size'),
  ]);

  const rows = await db.getAllAsync<{
    room_id: string;
    message_count: number;
    database_bytes: number;
    file_uris: string | null;
  }>(`
    SELECT
      room_id,
      COUNT(*) AS message_count,
      COALESCE(SUM(
        length(CAST(COALESCE(content, '') AS BLOB)) +
        length(CAST(COALESCE(sender_name, '') AS BLOB)) +
        length(CAST(COALESCE(type, '') AS BLOB)) +
        length(CAST(COALESCE(file_uri, '') AS BLOB)) +
        length(CAST(COALESCE(reactions, '') AS BLOB)) +
        length(CAST(COALESCE(reply_to, '') AS BLOB)) +
        length(CAST(COALESCE(media_ptr, '') AS BLOB))
      ), 0) AS database_bytes,
      GROUP_CONCAT(DISTINCT file_uri) AS file_uris
    FROM messages
    GROUP BY room_id
    ORDER BY database_bytes DESC
  `);

  const countedFiles = new Set<string>();
  const rooms: LocalChatStorageRoom[] = [];
  let mediaBytes = 0;

  for (const row of rows) {
    let roomMediaBytes = 0;
    for (const uri of (row.file_uris ?? '').split(',').filter(Boolean)) {
      if (countedFiles.has(uri)) continue;
      countedFiles.add(uri);
      try {
        const size = new File(uri).size;
        if (Number.isFinite(size) && size > 0) roomMediaBytes += size;
      } catch {
        // A cache-cleaned or permission-protected URI simply contributes zero.
      }
    }
    mediaBytes += roomMediaBytes;
    const databaseBytes = Number(row.database_bytes) || 0;
    rooms.push({
      roomId: row.room_id,
      messageCount: Number(row.message_count) || 0,
      databaseBytes,
      mediaBytes: roomMediaBytes,
      totalBytes: databaseBytes + roomMediaBytes,
    });
  }

  const databaseBytes = (Number(pageCount?.page_count) || 0) * (Number(pageSize?.page_size) || 0);
  return {
    databaseBytes,
    mediaBytes,
    totalBytes: databaseBytes + mediaBytes,
    rooms: rooms.sort((a, b) => b.totalBytes - a.totalBytes),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Light reference embedded in a reply so the bubble can render a quoted snippet
 *  without having to look up the original message. */
export interface ReplyRef {
  id: string;
  sender_name: string;
  /** Short preview of the original content (truncated client-side before sending). */
  content: string;
  /** Type of the original message ('text', 'image', etc.) — used to render an icon
   *  hint for non-text replies. */
  type?: string;
}

/** Pointer to an out-of-band media blob (Phase 2). The bytes live on the server
 *  (chat.MediaBlob) and are moved via HTTP (mediaLane); only this rides the WS. */
export interface MediaPointer {
  media_id: string;
  md5?: string | null;
  sha256?: string | null;
  size?: number | null;
  mime?: string | null;
}

export interface LocalMessage {
  id: string;
  room_id: string;
  sender_id: number;
  sender_name: string;
  content: string | null;
  type: string;
  file_uri: string | null;
  created_at: string;
  /** Last content/state mutation, used to reconcile cross-device edits. */
  updated_at?: string | null;
  /** Monotonic edit revision; timestamp resolves cross-device ordering. */
  revision?: number;
  is_mine: boolean;
  sync: boolean;
  status: 'pending' | 'delivered' | 'read';
  reactions: Record<string, string[]>;
  is_deleted: boolean;
  is_read: boolean;
  /** Set when this message is a reply to another. NULL otherwise. */
  reply_to: ReplyRef | null;
  /** Duration in milliseconds for voice/audio/video messages. NULL for text. */
  duration_ms: number | null;
  /** Out-of-band media pointer (Phase 2). NULL for text / legacy inline media. */
  media_ptr?: MediaPointer | null;
  /** Transfer failure is independent from pending/delivered/read lifecycle state. */
  transfer_error_code?: string | null;
  transfer_error_message?: string | null;
  auto_retry_blocked?: boolean;
}

/** Partial mutation that can be applied to a message and relayed to other devices. */
export type MessageChanges = {
  is_read?: boolean;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  content?: string;
  updated_at?: string;
  revision?: number;
  /** Display hint — which emoji was just toggled. NOT persisted to SQLite. */
  reacted_emoji?: string;
  /** Internal routing hint. A read receipt only needs to reach the original
   * message author; edits/reactions/deletes still fan out to every peer. */
  receipt_target_id?: number;
};

export interface OutboxEntry {
  id: string;
  room_id: string;
  message_id: string;
  changes: MessageChanges;
  expected_peer_ids: number[];
  acked_by_user_ids: number[];
  created_at: number;
}

function genOutboxId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function saveMessage(msg: LocalMessage): Promise<void> {
  // expo-sqlite passes primitiveParams as Map<String, Any> in Kotlin — Any is
  // non-nullable, so passing JS null through the bridge throws the
  // "Cannot convert '[object Object]' to a Kotlin type" error.
  // Fix: omit null values entirely; unbound SQLite named params default to NULL.
  const params: Record<string, string | number> = {
    $id:          String(msg.id),
    $room_id:     String(msg.room_id),
    $sender_id:   Number(msg.sender_id) || 0,
    $sender_name: String(msg.sender_name ?? ''),
    $type:        String(msg.type ?? 'text'),
    $created_at:  String(msg.created_at),
    $updated_at:  String(msg.updated_at ?? msg.created_at),
    $revision:    Number(msg.revision ?? 0),
    $is_mine:     msg.is_mine ? 1 : 0,
    $sync:        msg.sync ? 1 : 0,
    $status:      String(msg.status ?? 'pending'),
  };
  if (msg.content != null)  params.$content  = String(msg.content);
  if (msg.file_uri != null) params.$file_uri = String(msg.file_uri);
  if (!msg.is_mine || msg.sync) params.$accepted_at = String(msg.created_at);
  if (msg.reply_to != null) params.$reply_to = JSON.stringify(msg.reply_to);
  if (msg.duration_ms != null) params.$duration_ms = Number(msg.duration_ms);
  if (msg.media_ptr != null) params.$media_ptr = JSON.stringify(msg.media_ptr);

  await runSerializedWrite((db) => db.runAsync(
    `INSERT OR IGNORE INTO messages
       (id, room_id, sender_id, sender_name, content, type, file_uri, created_at, updated_at, revision, accepted_at, is_mine, sync, status, reply_to, duration_ms, media_ptr)
     VALUES ($id, $room_id, $sender_id, $sender_name, $content, $type, $file_uri, $created_at, $updated_at, $revision, $accepted_at, $is_mine, $sync, $status, $reply_to, $duration_ms, $media_ptr)`,
    params,
  ));
}

/** Store/replace the out-of-band media pointer for a message (after upload, or
 *  when a received pointer is persisted). */
export async function setMediaPointer(id: string, ptr: MediaPointer): Promise<void> {
  await runSerializedWrite((db) => db.runAsync(
    `UPDATE messages SET media_ptr = ? WHERE id = ?`,
    JSON.stringify(ptr), id,
  ));
}

/** Read the out-of-band media pointer for a message, or null if none. */
export async function getMediaPointer(id: string): Promise<MediaPointer | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ media_ptr: string | null }>(
    `SELECT media_ptr FROM messages WHERE id = ?`,
    id,
  );
  if (!row?.media_ptr) return null;
  try { return JSON.parse(row.media_ptr) as MediaPointer; } catch { return null; }
}

/** Record a visible media-transfer failure without changing lifecycle state. */
export async function setMessageTransferFailure(
  id: string,
  code: string,
  message: string,
  blockAutomaticRetry: boolean,
): Promise<void> {
  await runSerializedWrite((db) => db.runAsync(
    `UPDATE messages
       SET transfer_error_code = ?, transfer_error_message = ?, auto_retry_blocked = ?
     WHERE id = ?`,
    code, message, blockAutomaticRetry ? 1 : 0, id,
  ));
}

export async function clearMessageTransferFailure(id: string): Promise<void> {
  await runSerializedWrite((db) => db.runAsync(
    `UPDATE messages
       SET transfer_error_code = NULL, transfer_error_message = NULL, auto_retry_blocked = 0
     WHERE id = ?`,
    id,
  ));
}

export async function getMessageTransferFailure(
  id: string,
): Promise<{ code: string; message: string; blocked: boolean } | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{
    transfer_error_code: string | null;
    transfer_error_message: string | null;
    auto_retry_blocked: number;
  }>(
    `SELECT transfer_error_code, transfer_error_message, auto_retry_blocked
       FROM messages WHERE id = ?`,
    id,
  );
  if (!row?.transfer_error_code) return null;
  return {
    code: row.transfer_error_code,
    message: row.transfer_error_message || 'The transfer could not be completed.',
    blocked: row.auto_retry_blocked === 1,
  };
}

/** A received pointer-media row whose blob hasn't been downloaded yet. */
export interface IncompletePointerRow {
  id: string;
  room_id: string;
  sender_id: number;
  sender_name: string;
  content: string | null;
  type: string;
  created_at: string;
  reply_to: string | null;
  duration_ms: number | null;
  media_ptr: string;
}

/** Received out-of-band media in a room whose blob is still missing locally.
 *  Used to re-attempt downloads that were missed (e.g. app killed at receipt). */
export async function getIncompletePointerMedia(roomId?: string, limit = 50): Promise<IncompletePointerRow[]> {
  const db = await getDB();
  const base = `SELECT id, room_id, sender_id, sender_name, content, type, created_at, reply_to, duration_ms, media_ptr
     FROM messages
     WHERE is_mine = 0 AND media_ptr IS NOT NULL
       AND (file_uri IS NULL OR file_uri = '')`;
  return roomId
    ? await db.getAllAsync<IncompletePointerRow>(`${base} AND room_id = ? ORDER BY created_at ASC LIMIT ?`, roomId, limit)
    : await db.getAllAsync<IncompletePointerRow>(`${base} ORDER BY created_at ASC LIMIT ?`, limit);
}

export async function markDelivered(
  messageId: string,
  recipientId: number
): Promise<void> {
  await runSerializedWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO delivery_tracking (message_id, recipient_id, delivered)
       VALUES (?, ?, 1)`,
      messageId, recipientId,
    );

    const rows = await db.getAllAsync<{ total: number; delivered: number }>(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN delivered = 1 THEN 1 ELSE 0 END), 0) AS delivered
       FROM delivery_tracking
       WHERE message_id = ?`,
      messageId,
    );
    const first = rows.length > 0 ? rows[0] : null;
    if (!first) return;
    const { total, delivered } = first;
    if (total > 0 && total === delivered) {
      await db.runAsync(`UPDATE messages SET status = 'delivered' WHERE id = ?`, messageId);
    }
  });
}

/**
 * Return IDs (+ room) of messages sent by me that are still locally marked
 * 'pending' (i.e. not yet confirmed delivered or read). Used to reconcile
 * delivery ticks after the sender was offline when the recipient acked.
 * Capped and limited to recent messages to keep the payload small.
 */
export async function getPendingSentMessageIds(
  limit = 200,
): Promise<{ id: string; room_id: string }[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM messages
       WHERE is_mine = 1 AND status = 'pending' AND is_deleted = 0
       ORDER BY created_at DESC
       LIMIT ?`,
    limit,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMessages(roomId: string): Promise<LocalMessage[]> {  const db = await getDB();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string | null;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC`,
    roomId
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

export async function messageExists(id: string): Promise<boolean> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM messages WHERE id = ?`,
    id
  );
  return (row?.c ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// RRP idempotency ledger (processed_events)
// ---------------------------------------------------------------------------

/** Has this protocol-event id already been fully processed? */
export async function isEventProcessed(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDB();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM processed_events WHERE id = ?`,
    id
  );
  return (row?.c ?? 0) > 0;
}

/** Record a protocol-event id as fully processed (idempotent). */
export async function markEventProcessed(id: string, type?: string): Promise<void> {
  if (!id) return;
  await runSerializedWrite((db) => db.runAsync(
    `INSERT OR IGNORE INTO processed_events (id, type, ts) VALUES (?, ?, ?)`,
    id,
    type ?? null,
    Date.now()
  ));
}

/** Drop ledger rows older than the retention window. Call occasionally. */
export async function pruneProcessedEvents(): Promise<void> {
  await runSerializedWrite((db) => db.runAsync(
    `DELETE FROM processed_events WHERE ts < ?`,
    Date.now() - PROCESSED_EVENT_TTL_MS
  ));
}

// ---------------------------------------------------------------------------
// RRP sync.digest helpers
// ---------------------------------------------------------------------------

/**
 * Build a per-room digest of the most recent message ids we hold locally.
 * Used on (re)connect to let the peer router detect and request any gaps.
 */
export async function getRecentMessageDigest(
  perRoom = 40,
  lookbackDays = 14,
): Promise<Array<{ room_id: string; ids: string[]; entries: MessageDigestEntry[] }>> {
  const db = await getDB();
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    updated_at: string | null;
    revision: number | null;
    is_deleted: number;
  }>(
    `SELECT id, room_id, updated_at, revision, is_deleted FROM (
       SELECT id, room_id, updated_at, revision, is_deleted,
              ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) AS room_rank
       FROM messages
       WHERE created_at >= ?
     ) WHERE room_rank <= ?`,
    since,
    perRoom,
  );
  const byRoom = new Map<string, MessageDigestEntry[]>();
  for (const r of rows) {
    const arr = byRoom.get(r.room_id) ?? [];
    if (arr.length < perRoom) {
      arr.push({
        id: r.id,
        updated_at: r.updated_at || '',
        revision: Number(r.revision ?? 0),
        is_deleted: r.is_deleted === 1,
      });
      byRoom.set(r.room_id, arr);
    }
  }
  return Array.from(byRoom.entries()).map(([room_id, entries]) => ({
    room_id,
    ids: entries.map((entry) => entry.id),
    entries,
  }));
}

/**
 * Bound internal metadata without discarding normal chat history. Deleted
 * tombstones remain for six months (well beyond the 14-day delta window), and
 * are removed only after their update outbox is fully acknowledged.
 */
export async function pruneLocalData(): Promise<void> {
  await runSerializedWrite(pruneLocalDataWithDb);
}

async function pruneLocalDataWithDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const now = Date.now();
  const deletedBefore = new Date(now - DELETED_MESSAGE_RETENTION_MS).toISOString();
  const removableFiles = await db.getAllAsync<{ file_uri: string }>(`
    SELECT DISTINCT m.file_uri
    FROM messages m
    WHERE m.is_deleted = 1
      AND COALESCE(m.updated_at, m.created_at) < ?
      AND m.file_uri IS NOT NULL AND m.file_uri != ''
      AND NOT EXISTS (SELECT 1 FROM update_outbox o WHERE o.message_id = m.id)
  `, deletedBefore);

  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM processed_events WHERE ts < ?`, now - PROCESSED_EVENT_TTL_MS);
    await db.runAsync(`
      DELETE FROM processed_events
      WHERE id IN (
        SELECT id FROM processed_events ORDER BY ts DESC LIMIT -1 OFFSET ?
      )
    `, MAX_PROCESSED_EVENTS);
    await db.runAsync(`
      DELETE FROM messages
      WHERE is_deleted = 1
        AND COALESCE(updated_at, created_at) < ?
        AND NOT EXISTS (SELECT 1 FROM update_outbox o WHERE o.message_id = messages.id)
    `, deletedBefore);
    await db.runAsync(`DELETE FROM delivery_tracking WHERE message_id NOT IN (SELECT id FROM messages)`);
    await db.runAsync(`DELETE FROM update_outbox WHERE message_id NOT IN (SELECT id FROM messages)`);

    const owners = await db.getAllAsync<{ owner_user_id: number }>(
      `SELECT DISTINCT owner_user_id FROM call_cache`,
    );
    for (const { owner_user_id: ownerId } of owners) {
      await db.runAsync(`
        DELETE FROM call_cache
        WHERE owner_user_id = ? AND call_id NOT IN (
          SELECT call_id FROM call_cache
          WHERE owner_user_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        )
      `, ownerId, ownerId, MAX_CACHED_CALLS_PER_ACCOUNT);
    }
  });

  for (const { file_uri: uri } of removableFiles) {
    if (!uri.startsWith(Paths.cache.uri) && !uri.startsWith(Paths.document.uri)) continue;
    const stillReferenced = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM messages WHERE file_uri = ?`, uri,
    );
    if ((Number(stillReferenced?.count) || 0) > 0) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // A system-cleaned cache file needs no further work.
    }
  }
}

/** Compare a peer's versioned digest with local rows for one room. */
export async function getMessageDeltaRequests(
  roomId: string,
  entries: MessageDigestEntry[],
): Promise<{ missingIds: string[]; staleIds: string[] }> {
  if (!entries.length) return { missingIds: [], staleIds: [] };
  const db = await getDB();
  const ids = [...new Set(entries.map((entry) => entry.id).filter(Boolean))];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{
    id: string;
    updated_at: string | null;
    revision: number | null;
    is_deleted: number;
  }>(
    `SELECT id, updated_at, revision, is_deleted
       FROM messages WHERE room_id = ? AND id IN (${placeholders})`,
    roomId,
    ...ids,
  );
  return partitionRemoteDigest(entries, rows.map((row) => ({
    id: row.id,
    updated_at: row.updated_at || '',
    revision: Number(row.revision ?? 0),
    is_deleted: row.is_deleted === 1,
  })));
}

export interface MessageStateDelta {
  message_id: string;
  changes: MessageChanges;
}

/** Return the latest local state for peer-requested message rows. */
export async function getMessageStateDeltas(
  roomId: string,
  ids: string[],
): Promise<MessageStateDelta[]> {
  if (!ids.length) return [];
  const db = await getDB();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{
    id: string;
    content: string | null;
    reactions: string | null;
    is_deleted: number;
    updated_at: string | null;
    revision: number | null;
  }>(
    `SELECT id, content, reactions, is_deleted, updated_at, revision
       FROM messages WHERE room_id = ? AND id IN (${placeholders})`,
    roomId,
    ...uniqueIds,
  );
  return rows.map((row) => ({
    message_id: row.id,
    changes: {
      ...(row.is_deleted === 1 ? { is_deleted: true } : { content: row.content ?? '' }),
      reactions: row.reactions ? JSON.parse(row.reactions) : {},
      updated_at: row.updated_at || '',
      revision: Number(row.revision ?? 0),
    },
  }));
}

/** Of the given candidate ids, return the subset we do NOT have for this room. */
export async function filterMissingMessageIds(
  roomId: string,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const db = await getDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM messages WHERE room_id = ? AND id IN (${placeholders})`,
    roomId,
    ...ids
  );
  const have = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

/** Returns undelivered outbound messages for a specific recipient in a room. */
export async function getPendingOutbox(
  roomId: string,
  myUserId: number,
  recipientId: number
): Promise<LocalMessage[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string | null;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT m.*
     FROM messages m
     LEFT JOIN delivery_tracking dt
       ON dt.message_id = m.id AND dt.recipient_id = ?
     WHERE m.room_id = ?
       AND m.sender_id = ?
       AND COALESCE(m.auto_retry_blocked, 0) = 0
       AND (dt.delivered IS NULL OR dt.delivered = 0)
     ORDER BY m.created_at ASC`,
    recipientId, roomId, myUserId
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

/** Return the stored file_uri for a message (null if none / row absent). */
export async function getMessageFileUri(messageId: string): Promise<string | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ file_uri: string | null }>(
    `SELECT file_uri FROM messages WHERE id = ?`,
    messageId,
  );
  return row?.file_uri ?? null;
}

/** Backfill a message's media file_uri (e.g. after hydrating a push-only row). */
export async function setMessageFileUri(messageId: string, fileUri: string): Promise<void> {
  await runSerializedWrite((db) =>
    db.runAsync(`UPDATE messages SET file_uri = ? WHERE id = ?`, fileUri, messageId)
  );
}

/**
 * Per-room digest of RECEIVED media messages whose media never landed locally
 * (row exists but file_uri IS NULL) — e.g. saved from a push that stripped the
 * base64 blob. Used to ask the sender to re-send the media over the WS.
 */
export async function getIncompleteMediaDigest(
  perRoom = 40,
  lookbackDays = 14,
): Promise<Array<{ room_id: string; ids: string[] }>> {
  const db = await getDB();
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM messages
     WHERE is_mine = 0
       AND is_deleted = 0
       AND type IN ('voice', 'image')
       AND (file_uri IS NULL OR file_uri = '')
       AND created_at >= ?
     ORDER BY created_at DESC`,
    since,
  );
  const byRoom = new Map<string, string[]>();
  for (const r of rows) {
    const arr = byRoom.get(r.room_id) ?? [];
    if (arr.length < perRoom) {
      arr.push(r.id);
      byRoom.set(r.room_id, arr);
    }
  }
  return Array.from(byRoom.entries()).map(([room_id, ids]) => ({ room_id, ids }));
}

/**
 * Load specific messages I authored (by id) so they can be re-sent on demand
 * (e.g. a peer asked to hydrate media it received via a b64-stripped push).
 * Unlike getPendingOutbox this ignores delivery state — a delivered media
 * message must still be resendable when its media was never received.
 */
export async function getMessagesByIdsForResend(
  roomId: string,
  myUserId: number,
  ids: string[],
): Promise<LocalMessage[]> {
  if (!ids.length) return [];
  const db = await getDB();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string | null;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT * FROM messages
     WHERE room_id = ?
       AND sender_id = ?
       AND id IN (${placeholders})
     ORDER BY created_at ASC`,
    roomId, myUserId, ...ids,
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

/**
 * Toggle a reaction on a message (one reaction per user across all emoji).
 * Tapping the same emoji again removes it; tapping a different one replaces it.
 * Returns the new reactions map so the caller can queue a sync update.
 */
export async function toggleReaction(
  messageId: string,
  emoji: string,
  userId: string,
): Promise<Record<string, string[]>> {
  return runSerializedWrite(async (db) => {
    const row = await db.getFirstAsync<{ reactions: string }>(
      `SELECT reactions FROM messages WHERE id = ?`,
      messageId,
    );
    const reactions: Record<string, string[]> = row?.reactions
      ? JSON.parse(row.reactions)
      : {};

    const alreadyOnThisEmoji = reactions[emoji]?.includes(userId) ?? false;
    // Remove userId from ALL emoji (one reaction per user)
    for (const key of Object.keys(reactions)) {
      reactions[key] = reactions[key].filter((id) => id !== userId);
      if (reactions[key].length === 0) delete reactions[key];
    }
    // Add to selected emoji only if it wasn't already there (toggle off if same)
    if (!alreadyOnThisEmoji) {
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji].push(userId);
    }

    await db.runAsync(
      `UPDATE messages SET reactions = $json WHERE id = $id`,
      { $json: JSON.stringify(reactions), $id: messageId },
    );
    return reactions;
  });
}

// ---------------------------------------------------------------------------
// Outbox (pending sync updates)
// ---------------------------------------------------------------------------

/** Queue a mutation to be relayed to other devices via the chat WebSocket. */
export async function queueMessageUpdate(
  roomId: string,
  messageId: string,
  changes: MessageChanges,
  opts: { id?: string; expectedPeerIds?: number[] } = {},
): Promise<string> {
  const id = opts.id ?? genOutboxId();
  const peers = [...new Set((opts.expectedPeerIds ?? []).filter((userId) => Number.isInteger(userId) && userId > 0))];
  await runSerializedWrite(async (db) => {
    // Delivery acceptance is separate from content convergence. Stamp every
    // mutation with an edit version instead of resetting a sync boolean.
    const current = await db.getFirstAsync<{ revision: number | null }>(
      `SELECT revision FROM messages WHERE id = ?`, messageId,
    );
    if (!changes.updated_at) changes.updated_at = new Date().toISOString();
    if (changes.revision == null) changes.revision = (Number(current?.revision) || 0) + 1;
    await db.runAsync(
      `INSERT OR IGNORE INTO update_outbox
         (id, room_id, message_id, changes, expected_peer_ids, acked_by_user_ids, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?)`,
      id, roomId, messageId, JSON.stringify(changes), JSON.stringify(peers), Date.now(),
    );
    await db.runAsync(
      `UPDATE messages SET updated_at = ?, revision = ? WHERE id = ?`,
      changes.updated_at, changes.revision, messageId,
    );
  });
  return id;
}

/**
 * Local-first history page. The nested newest-first query lets SQLite use the
 * room/created_at index, while callers still receive chronological rows for
 * the chat renderer.
 */
export async function getRecentMessages(roomId: string, limit = 60): Promise<LocalMessage[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM (
       SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?
     ) ORDER BY created_at ASC`,
    roomId,
    limit,
  );
  return normaliseMessages(rows);
}

/** Fetch one older local history page without touching the server. */
export async function getMessagesBefore(
  roomId: string,
  beforeCreatedAt: string,
  limit = 60,
): Promise<LocalMessage[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM (
       SELECT * FROM messages
       WHERE room_id = ? AND created_at < ?
       ORDER BY created_at DESC LIMIT ?
     ) ORDER BY created_at ASC`,
    roomId,
    beforeCreatedAt,
    limit,
  );
  return normaliseMessages(rows);
}

/** Read only the rows changed by a realtime mutation; avoids reloading a room. */
export async function getMessagesByIds(messageIds: string[]): Promise<LocalMessage[]> {
  if (!messageIds.length) return [];
  const db = await getDB();
  const ids = [...new Set(messageIds)];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM messages WHERE id IN (${placeholders})`,
    ...ids,
  );
  return normaliseMessages(rows);
}

function normaliseMessages(rows: any[]): LocalMessage[] {
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

/** Load all pending outbox entries for a room (or all rooms if omitted). */
export async function getPendingOutboxUpdates(roomId?: string): Promise<OutboxEntry[]> {
  const db = await getDB();
  const rows: Array<{ id: string; room_id: string; message_id: string; changes: string; expected_peer_ids?: string; acked_by_user_ids?: string; created_at: number }> = roomId
    ? await db.getAllAsync(`SELECT * FROM update_outbox WHERE room_id = ? ORDER BY created_at ASC`, roomId)
    : await db.getAllAsync(`SELECT * FROM update_outbox ORDER BY created_at ASC`);
  return rows.map((r) => ({
    ...r,
    changes: JSON.parse(r.changes) as MessageChanges,
    expected_peer_ids: r.expected_peer_ids ? JSON.parse(r.expected_peer_ids) as number[] : [],
    acked_by_user_ids: r.acked_by_user_ids ? JSON.parse(r.acked_by_user_ids) as number[] : [],
  }));
}

/**
 * Returns messages sent by me in a room that have never been acknowledged
 * (i.e. no delivery_tracking entry with delivered=1 exists for them).
 * Used to retry delivery when opening a chat room where recipients may have
 * been offline when the messages were originally sent.
 */
export async function getUndeliveredSentMessages(
  roomId: string,
  myUserId: number,
  sinceMs = 30 * 24 * 60 * 60 * 1000, // 30 days
): Promise<LocalMessage[]> {
  const db = await getDB();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT m.*
     FROM messages m
     WHERE m.room_id = ?
       AND m.sender_id = ?
       AND m.is_deleted = 0
       AND COALESCE(m.auto_retry_blocked, 0) = 0
       AND m.created_at >= ?
       AND NOT EXISTS (
         SELECT 1 FROM delivery_tracking dt
         WHERE dt.message_id = m.id AND dt.delivered = 1
       )
     ORDER BY m.created_at ASC`,
    roomId, myUserId, since,
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

/**
 * Fallback resend query: outgoing rows that are still pending and unsynced.
 * Useful when delivery_tracking metadata is missing or out-of-sync.
 */
export async function getPendingUnsyncedOutgoingMessages(
  roomId: string,
  myUserId: number,
  sinceMs = 30 * 24 * 60 * 60 * 1000,
): Promise<LocalMessage[]> {
  const db = await getDB();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT *
     FROM messages
     WHERE room_id = ?
       AND sender_id = ?
       AND is_deleted = 0
       AND created_at >= ?
       AND accepted_at IS NULL
       AND status = 'pending'
       AND COALESCE(auto_retry_blocked, 0) = 0
     ORDER BY created_at ASC`,
    roomId, myUserId, since,
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    sync:       r.sync       === 1,
    status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
    is_deleted: r.is_deleted === 1,
    is_read:    r.is_read    === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
    reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
  }));
}

/** Delete outbox entries that have been successfully relayed. */
export async function deleteOutboxUpdates(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await runSerializedWrite(async (db) => {
    for (const id of ids) {
      await db.runAsync(`DELETE FROM update_outbox WHERE id = ?`, id);
    }
  });
}

/** Record server acceptance without conflating it with content consistency. */
export async function setMessageSyncState(messageId: string, synced: boolean): Promise<void> {
  if (!synced) return;
  await runSerializedWrite((db) => db.runAsync(
    `UPDATE messages SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?`,
    new Date().toISOString(), messageId,
  ));
}

/**
 * Acknowledge outbox updates by ID:
 * - record the acknowledging peer
 * - delete a row only after every expected peer has acknowledged it
 * - set sync=1 only for messages with no remaining pending update rows
 */
export async function ackOutboxUpdates(ids: string[], ackedByUserId?: number): Promise<void> {
  if (!ids.length) return;
  await runSerializedWrite(async (db) => {
    for (const id of ids) {
      const row = await db.getFirstAsync<{ expected_peer_ids?: string; acked_by_user_ids?: string }>(
        `SELECT expected_peer_ids, acked_by_user_ids FROM update_outbox WHERE id = ?`, id,
      );
      if (!row) continue;
      const expected = row.expected_peer_ids ? JSON.parse(row.expected_peer_ids) as number[] : [];
      const acked = row.acked_by_user_ids ? JSON.parse(row.acked_by_user_ids) as number[] : [];
      const nextAcked = ackedByUserId && ackedByUserId > 0
        ? [...new Set([...acked, ackedByUserId])]
        : acked;
      // Existing outbox rows have no delivery plan, so preserve their old
      // first-ack behaviour. Newly created rows wait for every planned peer.
      const complete = expected.length === 0 || expected.every((peerId) => nextAcked.includes(peerId));
      if (complete) {
        await db.runAsync(`DELETE FROM update_outbox WHERE id = ?`, id);
      } else {
        await db.runAsync(
          `UPDATE update_outbox SET acked_by_user_ids = ? WHERE id = ?`,
          JSON.stringify(nextAcked), id,
        );
      }
    }
  });
}

/**
 * Apply a remote mutation to the local messages table.
 * Called when a message_update event is received from another device.
 */
export async function applyMessageChanges(
  messageId: string,
  changes: MessageChanges,
): Promise<void> {
  await runSerializedWrite(async (db) => {
    const current = await db.getFirstAsync<{ updated_at: string | null; revision: number | null }>(
      `SELECT updated_at, revision FROM messages WHERE id = ?`, messageId,
    );
    // A delayed frame can arrive through a second transport. Apply only the
    // newest edit; old clients without version metadata remain compatible.
    if (changes.updated_at && current?.updated_at) {
      const incomingRevision = Number(changes.revision ?? 0);
      const currentRevision = Number(current.revision ?? 0);
      if (changes.updated_at < current.updated_at ||
          (changes.updated_at === current.updated_at && incomingRevision < currentRevision)) return;
    }
    if (changes.is_read !== undefined) {
      await db.runAsync(`UPDATE messages SET is_read = ? WHERE id = ?`, changes.is_read ? 1 : 0, messageId);
      if (changes.is_read) {
        await db.runAsync(`UPDATE messages SET status = 'read' WHERE id = ?`, messageId);
      }
    }
    if (changes.reactions !== undefined) {
      await db.runAsync(
        `UPDATE messages SET reactions = $json WHERE id = $id`,
        { $json: JSON.stringify(changes.reactions), $id: messageId },
      );
    }
    if (changes.is_deleted) {
      await db.runAsync(
        `UPDATE messages SET is_deleted = 1, content = NULL WHERE id = $id`,
        { $id: messageId },
      );
    }
    if (changes.content !== undefined && !changes.is_deleted) {
      await db.runAsync(
        `UPDATE messages SET content = $content WHERE id = $id`,
        { $content: changes.content, $id: messageId },
      );
    }
    if (changes.updated_at) {
      await db.runAsync(
        `UPDATE messages SET updated_at = ?, revision = MAX(COALESCE(revision, 0), ?) WHERE id = ?`,
        changes.updated_at, Number(changes.revision ?? 0), messageId,
      );
    }
  });
}

/** Rooms that still have an outgoing message awaiting Axion acceptance. */
export async function getRoomsWithPendingOutgoingMessages(
  myUserId: number,
  sinceMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string[]> {
  const db = await getDB();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = await db.getAllAsync<{ room_id: string }>(
    `SELECT DISTINCT room_id FROM messages
     WHERE is_mine = 1 AND sender_id = ? AND accepted_at IS NULL
       AND COALESCE(auto_retry_blocked, 0) = 0 AND created_at >= ?`,
    myUserId,
    since,
  );
  return rows.map((row) => row.room_id).filter(Boolean);
}

/** Soft-delete a message locally (content cleared, is_deleted=1). */
export async function deleteMessage(messageId: string): Promise<void> {
  await runSerializedWrite((db) => db.runAsync(
    `UPDATE messages SET is_deleted = 1, content = NULL WHERE id = $id`,
    { $id: messageId },
  ));
}

/** Delete every locally-cached message + outbox entry for a room.
 *  Used when the user chooses "Delete chat" from the chat list. */
export async function deleteRoomMessages(roomId: string): Promise<void> {
  const fileRows = await runSerializedWrite(async (db) => {
    const rows = await db.getAllAsync<{ file_uri: string }>(
      `SELECT DISTINCT file_uri FROM messages WHERE room_id = $rid AND file_uri IS NOT NULL AND file_uri != ''`,
      { $rid: roomId },
    );
    await db.runAsync(`DELETE FROM messages WHERE room_id = $rid`, { $rid: roomId });
    await db.runAsync(`DELETE FROM update_outbox WHERE room_id = $rid`, { $rid: roomId });
    return rows;
  });

  // Delete only files owned by this app, and only when no other cached room
  // references them. Picker/source URIs outside the app's directories are left
  // untouched deliberately.
  for (const { file_uri: uri } of fileRows) {
    const db = await getDB();
    const stillReferenced = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM messages WHERE file_uri = $uri`,
      { $uri: uri },
    );
    if ((Number(stillReferenced?.count) || 0) > 0) continue;
    if (!uri.startsWith(Paths.cache.uri) && !uri.startsWith(Paths.document.uri)) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // A partially removed or inaccessible cache file is safe to ignore.
    }
  }
}

/** Update the recipient plan after the server accepts and validates a relay. */
export async function setOutboxExpectedPeers(id: string, peerIds: number[]): Promise<void> {
  const expected = [...new Set(peerIds.filter((userId) => Number.isInteger(userId) && userId > 0))];
  await runSerializedWrite(async (db) => {
    const row = await db.getFirstAsync<{ acked_by_user_ids?: string }>(
      `SELECT acked_by_user_ids FROM update_outbox WHERE id = ?`, id,
    );
    if (!row) return;
    const acked = row.acked_by_user_ids ? JSON.parse(row.acked_by_user_ids) as number[] : [];
    if (expected.length === 0 || expected.every((peerId) => acked.includes(peerId))) {
      await db.runAsync(`DELETE FROM update_outbox WHERE id = ?`, id);
      return;
    }
    await db.runAsync(
      `UPDATE update_outbox SET expected_peer_ids = ? WHERE id = ?`,
      JSON.stringify(expected), id,
    );
  });
}

/** Ids of received (not-mine), unread, non-deleted messages in a room.
 *  Used by the notification "Mark as read" action to send read receipts. */
export async function getUnreadReceivedIds(roomId: string): Promise<string[]> {
  const db = await getDB();
  // Exclude media placeholders (voice/image/video/document whose file hasn't downloaded
  // yet): sending a read receipt for those would give the sender a false ✓✓
  // read for a file the recipient never actually received. They become
  // readable once the media hydrates (file_uri set).
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM messages
     WHERE room_id = $rid AND is_mine = 0 AND is_read = 0 AND is_deleted = 0
       AND NOT (type IN ('voice','image','video','document') AND (file_uri IS NULL OR file_uri = ''))`,
    { $rid: roomId },
  );
  return rows.map((r) => r.id);
}

/** Returns the most recent message per room (for ChatList preview). */
export async function getLastMessagePerRoom(): Promise<
  Record<string, LocalMessage>
> {
  const db = await getDB();
  const rows = await db.getAllAsync<{
    id: string;
    room_id: string;
    sender_id: number;
    sender_name: string;
    content: string | null;
    type: string;
    file_uri: string | null;
    created_at: string;
    is_mine: number;
    sync: number;
    status: string | null;
    reactions: string | null;
    is_deleted: number;
    is_read: number;
    reply_to: string | null;
    duration_ms: number | null;
  }>(
    `SELECT m.*
     FROM messages m
     INNER JOIN (
       SELECT room_id, MAX(created_at) AS latest
       FROM messages
       GROUP BY room_id
     ) sub ON m.room_id = sub.room_id AND m.created_at = sub.latest`
  );
  const result: Record<string, LocalMessage> = {};
  for (const r of rows) {
    result[r.room_id] = {
      ...r,
      is_mine:    r.is_mine    === 1,
      sync:       r.sync       === 1,
      status:     (r.status === 'read' ? 'read' : r.status === 'delivered' ? 'delivered' : 'pending'),
      is_deleted: r.is_deleted === 1,
      is_read:    r.is_read    === 1,
      reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
      reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
    };
  }
  return result;
}
