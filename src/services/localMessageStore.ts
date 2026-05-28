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
      is_deleted  INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, created_at);

    CREATE TABLE IF NOT EXISTS delivery_tracking (
      message_id   TEXT    NOT NULL,
      recipient_id INTEGER NOT NULL,
      delivered    INTEGER DEFAULT 0,
      PRIMARY KEY (message_id, recipient_id)
    );
  `);
  // Migrations for DBs created before reactions/is_deleted columns existed
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN reactions  TEXT    DEFAULT '{}'`); } catch {}
  try { await db.execAsync(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0`);    } catch {}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  await db.runAsync(
    `INSERT OR IGNORE INTO messages
       (id, room_id, sender_id, sender_name, content, type, file_uri, created_at, is_mine)
     VALUES ($id, $room_id, $sender_id, $sender_name, $content, $type, $file_uri, $created_at, $is_mine)`,
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
  }>(
    `SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC`,
    roomId
  );
  return rows.map((r) => ({
    ...r,
    is_mine:    r.is_mine    === 1,
    is_deleted: r.is_deleted === 1,
    reactions:  r.reactions  ? JSON.parse(r.reactions) : {},
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
  }));
}

/**
 * Toggle a reaction on a message (one reaction per user across all emoji).
 * Tapping the same emoji again removes it; tapping a different one replaces it.
 */
export async function toggleReaction(
  messageId: string,
  emoji: string,
  userId: string,
): Promise<void> {
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
}

/** Soft-delete a message locally (content cleared, is_deleted=1). */
export async function deleteMessage(messageId: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    `UPDATE messages SET is_deleted = 1, content = NULL WHERE id = $id`,
    { $id: messageId },
  );
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
    };
  }
  return result;
}
