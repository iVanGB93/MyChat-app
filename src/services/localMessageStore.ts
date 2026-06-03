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
  `);
  // Migrations for DBs created before new columns existed
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN reactions  TEXT    DEFAULT '{}'`); } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0`);    } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN is_read    INTEGER DEFAULT 0`);    } catch {}
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
  };
  if (msg.content != null)  params.$content  = String(msg.content);
  if (msg.file_uri != null) params.$file_uri = String(msg.file_uri);
  if (msg.reply_to != null) params.$reply_to = JSON.stringify(msg.reply_to);
  if (msg.duration_ms != null) params.$duration_ms = Number(msg.duration_ms);

  await db.runAsync(
    `INSERT OR IGNORE INTO messages
       (id, room_id, sender_id, sender_name, content, type, file_uri, created_at, is_mine, reply_to, duration_ms)
     VALUES ($id, $room_id, $sender_id, $sender_name, $content, $type, $file_uri, $created_at, $is_mine, $reply_to, $duration_ms)`,
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
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMessages(roomId: string): Promise<LocalMessage[]> {
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
    reactions: string | null;
    is_deleted: number;
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
    is_deleted: r.is_deleted === 1,
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
    reactions: string | null;
    is_deleted: number;
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
      is_deleted: r.is_deleted === 1,
      reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
      reply_to:   r.reply_to   ? (JSON.parse(r.reply_to) as ReplyRef) : null,
    };
  }
  return result;
}
