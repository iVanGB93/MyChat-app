/* ------------------------------------------------------------------ */
/*  Shared TypeScript types matching the Django backend models/API     */
/* ------------------------------------------------------------------ */

// ---- Users ----
export type ConnectivityMode = 'auto' | 'p2p' | 'server';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar: string | null;
  bio: string;
  /** Free-form label, defaults to username if empty. */
  display_name?: string;
  /** Short shareable handle assigned by the server, e.g. "AXN-7K3P". */
  user_tag?: string | null;
  /** Discoverability preferences (default: username on, email off). */
  discoverable_by_username?: boolean;
  discoverable_by_email?: boolean;
  is_online: boolean;
  last_seen: string;
  connectivity_mode: ConnectivityMode;
  notif_messages_enabled?: boolean;
  notif_calls_enabled?: boolean;
  notif_sound_enabled?: boolean;
}

export interface Contact {
  id: number;
  contact: number;
  contact_detail: User;
  created_at: string;
}

// ---- Chat ----
export interface LastMessage {
  id: string;
  sender: string;
  content: string;
  created_at: string;
}

export interface RoomMember {
  id: number;
  username: string;
  display_name?: string;
  user_tag?: string | null;
  is_online: boolean;
  avatar?: string | null;
}

export interface ChatRoom {
  id: string;           // UUID
  name: string;
  room_type: 'direct' | 'group';
  members: number[];
  members_detail: RoomMember[];
  last_message: LastMessage | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;           // UUID
  room: string;
  sender: number;
  sender_username: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'voice';
  file: string | null;
  /** Local file URI for media messages (voice / image). */
  file_uri?: string | null;
  /** Duration in milliseconds for voice / video messages. */
  duration_ms?: number | null;
  /** Local consistency flag: true when both ends have acknowledged the latest state. */
  sync?: boolean;
  is_read: boolean;
  created_at: string;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
  /** When this message is a reply, a snapshot of the original. */
  reply_to?: {
    id: string;
    sender_name: string;
    content: string;
    type?: string;
  } | null;
}

// ---- Calls ----
export type CallType = 'voice' | 'video';
export type CallStatus = 'initiated' | 'ringing' | 'ongoing' | 'ended' | 'missed' | 'rejected';

/** WebRTC ICE server configuration returned by /api/calls/ice-config/ */
export interface IceConfig {
  /** RTCIceServer array ready to pass directly to RTCPeerConnection */
  ice_servers: RTCIceServer[];
  /** 'all' = try everything | 'relay' = TURN only (server-mediated) */
  ice_transport_policy: 'all' | 'relay';
}

export interface CallLog {
  id: string;           // UUID
  caller: number;
  caller_username: string;
  callee: number;
  callee_username: string;
  call_type: CallType;
  status: CallStatus;
  room_name: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
}

// ---- Auth ----
export interface TokenPair {
  access: string;
  refresh: string;
}

// ---- Paginated response ----
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ---- Navigation ----
export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyEmail: { email: string; expiresIn: number };
  Main: undefined;
  Contacts: { prefillTag?: string } | undefined;
  ScanTag: undefined;
  ChatRoom: { roomId: string; roomName: string; otherUserId?: number };
  EditAccount: undefined;
  ChangePassword: undefined;
  BlockedUsers: undefined;
  /** Modal opened when the OS hands us a shared payload (text/url/image). */
  ShareTarget: {
    text?: string;
    imageUri?: string;
    imageMime?: string;
  };
  IncomingCall: {
    callId: string;
    callerName: string;
    callerId: number;
    callType: CallType;
    roomName: string;
  };
  ActiveCall: {
    callId: string;
    otherName: string;
    callType: CallType;
    roomName: string;
    isOutgoing: boolean;
    peerUserId: number;
  };
};
