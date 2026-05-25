/* ------------------------------------------------------------------ */
/*  Calls API — initiate, join, end, history                           */
/* ------------------------------------------------------------------ */

import api from './api';
import type { CallLog, CallType, IceConfig, PaginatedResponse } from '../types';

export interface InitiateCallResponse {
  call_id: string;
  room_name: string;
  call_type: CallType;
  token: string | null;
  livekit_url: string;
}

export async function initiateCall(calleeId: number, callType: CallType = 'video'): Promise<InitiateCallResponse> {
  const { data } = await api.post<InitiateCallResponse>('/api/calls/initiate/', {
    callee_id: calleeId,
    call_type: callType,
  });
  return data;
}

export async function joinCall(callId: string): Promise<InitiateCallResponse> {
  const { data } = await api.post<InitiateCallResponse>(`/api/calls/${callId}/join/`);
  return data;
}

export async function endCall(callId: string, action: 'end' | 'reject' = 'end'): Promise<{ status: string }> {
  const { data } = await api.post<{ status: string }>(`/api/calls/${callId}/end/`, { action });
  return data;
}

export async function getCallHistory(): Promise<CallLog[]> {
  const { data } = await api.get<PaginatedResponse<CallLog>>('/api/calls/history/');
  return data.results;
}

/** Fetch the current status of a single call (for polling fallback). */
export async function getCallStatus(callId: string): Promise<string> {
  const { data } = await api.get<{ status: string }>(`/api/calls/${callId}/status/`);
  return data.status;
}

/**
 * Fetch ICE server configuration for the authenticated user.
 * The server respects the user's `connectivity_mode` preference:
 *   auto   → STUN + TURN  (P2P first, relay fallback)
 *   p2p    → STUN only    (no relay)
 *   server → TURN only    (force relay, iceTransportPolicy = 'relay')
 *
 * Falls back to Google STUN only if the request fails.
 */
export async function getIceConfig(): Promise<IceConfig> {
  try {
    const { data } = await api.get<IceConfig>('/api/calls/ice-config/');
    return data;
  } catch {
    // Safe fallback so calls still work without server ICE config
    return {
      ice_servers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      ice_transport_policy: 'all',
    };
  }
}
