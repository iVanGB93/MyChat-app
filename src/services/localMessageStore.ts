/**
 * localMessageStore.ts
 *
 * Thin wrapper around expo-sqlite for storing chat messages locally on the device.
 * No message content ever touches the server — only signaling metadata (PendingDelivery)
 * is stored server-side.
 */

import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync("axonic_messages.db");
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function initDB(): Promise<void> {
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
      is_mine     INTEGER DEFAULT 0,
      sync        INTEGER DEFAULT 0,
      status      TEXT    DEFAULT 'pending',
      reactions   TEXT    DEFAULT '{}',
      is_deleted  INTEGER DEFAULT 0,
      is_read     INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at);

    CREATE TABLE IF NOT EXISTS delivery_tracking (
      message_id   TEXT    NOT NULL,
      recipient_id INTEGER NOT NULL,
      delivered    INTEGER DEFAULT 0,
      PRIMARY KEY (message_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS update_outbox (
      id         TEXT    PRIMARY KEY,
      room_id    TEXT    NOT NULL,
      message_id TEXT    NOT NULL,
      changes    TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- RRP: persistent idempotency ledger. Every inbound protocol event whose
    -- id has been fully processed is recorded here so the same event arriving
    -- over a second transport (or after a cold restart) is a no-op.
    CREATE TABLE IF NOT EXISTS processed_events (
      id   TEXT    PRIMARY KEY,
      type TEXT,
      ts   INTEGER NOT NULL
    );
  `);
  // Migrations for DBs created before new columns existed
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN reactions  TEXT    DEFAULT '{}'`); } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0`);    } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN is_read    INTEGER DEFAULT 0`);    } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN sync       INTEGER DEFAULT 0`);    } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN status     TEXT    DEFAULT 'pending'`); } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN reply_to   TEXT`);                 } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER`);              } catch {}
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

export interface LocalMessage {
  id: string;
  room_id: string;
  sender_id: number;
  sender_name: string;
  content: string | null;
  type: string;
  file_uri: string | null;
  created_at: string;
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
}

/** Partial mutation that can be applied to a message and relayed to other devices. */
export type MessageChanges = {
  is_read?: boolean;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  content?: string;
  /** Display hint — which emoji was just toggled. NOT persisted to SQLite. */
  reacted_emoji?: string;
};

export interface OutboxEntry {
  id: string;
  room_id: string;
  message_id: string;
  changes: MessageChanges;
  created_at: number;
}

function genOutboxId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function saveMessage(msg: LocalMessage): Promise<void> {
  const db = await getDB();
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
    $is_mine:     msg.is_mine ? 1 : 0,
    $sync:        msg.sync ? 1 : 0,
    $status:      String(msg.status ?? 'pending'),
  };
  if (msg.content != null)  params.$content  = String(msg.content);
  if (msg.file_uri != null) params.$file_uri = String(msg.file_uri);
  if (msg.reply_to != null) params.$reply_to = JSON.stringify(msg.reply_to);
  if (msg.duration_ms != null) params.$duration_ms = Number(msg.duration_ms);

  await db.runAsync(
    `INSERT OR IGNORE INTO messages
       (id, room_id, sender_id, sender_name, content, type, file_uri, created_at, is_mine, sync, status, reply_to, duration_ms)
     VALUES ($id, $room_id, $sender_id, $sender_name, $content, $type, $file_uri, $created_at, $is_mine, $sync, $status, $reply_to, $duration_ms)`,
    params,
  );
}

export async function markDelivered(
  messageId: string,
  recipientId: number
): Promise<void> {
  const db = await getDB();
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
    await db.runAsync(`UPDATE messages SET sync = 1, status = 'delivered' WHERE id = ?`, messageId);
  }
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

const PROCESSED_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
  const db = await getDB();
  await db.runAsync(
    `INSERT OR IGNORE INTO processed_events (id, type, ts) VALUES (?, ?, ?)`,
    id,
    type ?? null,
    Date.now()
  );
}

/** Drop ledger rows older than the retention window. Call occasionally. */
export async function pruneProcessedEvents(): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `DELETE FROM processed_events WHERE ts < ?`,
    Date.now() - PROCESSED_EVENT_TTL_MS
  );
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
): Promise<Array<{ room_id: string; ids: string[] }>> {
  const db = await getDB();
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM messages WHERE created_at >= ? ORDER BY created_at DESC`,
    since
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
  const db = await getDB();
  await db.runAsync(`UPDATE messages SET file_uri = ? WHERE id = ?`, fileUri, messageId);
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
       AND is_deleted = 0
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
  const db = await getDB();
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
}

// ---------------------------------------------------------------------------
// Outbox (pending sync updates)
// ---------------------------------------------------------------------------

/** Queue a mutation to be relayed to other devices via the chat WebSocket. */
export async function queueMessageUpdate(
  roomId: string,
  messageId: string,
  changes: MessageChanges,
): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `INSERT INTO update_outbox (id, room_id, message_id, changes, created_at) VALUES (?, ?, ?, ?, ?)`,
    genOutboxId(), roomId, messageId, JSON.stringify(changes), Date.now(),
  );
  // Any local mutation means this row is no longer guaranteed to match the peer.
  await db.runAsync(`UPDATE messages SET sync = 0 WHERE id = ?`, messageId);
}

/** Load all pending outbox entries for a room (or all rooms if omitted). */
export async function getPendingOutboxUpdates(roomId?: string): Promise<OutboxEntry[]> {
  const db = await getDB();
  const rows: Array<{ id: string; room_id: string; message_id: string; changes: string; created_at: number }> = roomId
    ? await db.getAllAsync(`SELECT * FROM update_outbox WHERE room_id = ? ORDER BY created_at ASC`, roomId)
    : await db.getAllAsync(`SELECT * FROM update_outbox ORDER BY created_at ASC`);
  return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) as MessageChanges }));
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
       AND sync = 0
       AND status = 'pending'
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

/** Delete outbox entries that have been successfully sent. */
export async function deleteOutboxUpdates(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDB();
  for (const id of ids) {
    await db.runAsync(`DELETE FROM update_outbox WHERE id = ?`, id);
  }
}

/** Force a message row sync state. */
export async function setMessageSyncState(messageId: string, synced: boolean): Promise<void> {
  const db = await getDB();
  await db.runAsync(`UPDATE messages SET sync = ? WHERE id = ?`, synced ? 1 : 0, messageId);
}

/**
 * Acknowledge outbox updates by ID:
 * - delete matching update_outbox rows
 * - set sync=1 only for messages with no remaining pending update rows
 */
export async function ackOutboxUpdates(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDB();

  const msgRows = await db.getAllAsync<{ message_id: string }>(
    `SELECT DISTINCT message_id FROM update_outbox WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  const messageIds = msgRows.map((r) => r.message_id);

  for (const id of ids) {
    await db.runAsync(`DELETE FROM update_outbox WHERE id = ?`, id);
  }

  for (const messageId of messageIds) {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM update_outbox WHERE message_id = ?`,
      messageId,
    );
    if ((row?.c ?? 0) === 0) {
      await db.runAsync(`UPDATE messages SET sync = 1 WHERE id = ?`, messageId);
    }
  }
}

/**
 * Apply a remote mutation to the local messages table.
 * Called when a message_update event is received from another device.
 */
export async function applyMessageChanges(
  messageId: string,
  changes: MessageChanges,
): Promise<void> {
  const db = await getDB();
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
}

/** Soft-delete a message locally (content cleared, is_deleted=1). */
export async function deleteMessage(messageId: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `UPDATE messages SET is_deleted = 1, content = NULL WHERE id = $id`,
    { $id: messageId },
  );
}

/** Delete every locally-cached message + outbox entry for a room.
 *  Used when the user chooses "Delete chat" from the chat list. */
export async function deleteRoomMessages(roomId: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM messages WHERE room_id = $rid`, { $rid: roomId });
  await db.runAsync(`DELETE FROM update_outbox WHERE room_id = $rid`, { $rid: roomId });
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
