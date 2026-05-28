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
  is_online: boolean;
  last_seen: string;
  connectivity_mode: ConnectivityMode;
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
  is_online: boolean;
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
  message_type: 'text' | 'image' | 'file';
  file: string | null;
  is_read: boolean;
  created_at: string;
  reactions?: Record<string, string[]>;
  is_deleted?: boolean;
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
  Main: undefined;
  Contacts: undefined;
  ChatRoom: { roomId: string; roomName: string; otherUserId?: number };
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
