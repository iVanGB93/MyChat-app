/** Shared Axion transport types. Kept dependency-free so routing, UI, and the
 * transport singleton can all reference them without creating module cycles. */
export interface NotificationPayload {
  event: string;
  call_id?: string;
  caller?: string;
  caller_id?: number;
  callee?: string;
  callee_id?: number;
  call_type?: 'voice' | 'video';
  room_name?: string;
  room_id?: string;
  action?: string;
  signal_type?: string;
  data?: any;
  from_user_id?: number;
  from_username?: string;
  sender?: string;
  sender_id?: number;
  content?: string;
  message_id?: string;
  created_at?: string;
  correlation_id?: string;
  correlationId?: string;
  route_reason?: string;
  routeReason?: string;
  /** Server also queued an FCM/Expo push for this delivery. */
  push_floor?: boolean;
  [key: string]: any;
}

export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'no-internet';
