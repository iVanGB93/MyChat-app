/* ------------------------------------------------------------------ */
/*  Chat API — rooms & messages                                        */
/* ------------------------------------------------------------------ */

import api from './api';
import type { ChatRoom, Message, PaginatedResponse } from '../types';

export async function getRooms(): Promise<ChatRoom[]> {
  const { data } = await api.get<PaginatedResponse<ChatRoom>>('/api/chat/rooms/');
  return data.results;
}

export async function getOrCreateDirect(userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>('/api/chat/rooms/direct/', { user_id: userId });
  return data;
}

export async function createGroupRoom(name: string, memberIds: number[]): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>('/api/chat/rooms/', {
    name,
    room_type: 'group',
    members: memberIds,
  });
  return data;
}

export async function getRoomMessages(roomId: string, page = 1): Promise<PaginatedResponse<Message>> {
  const { data } = await api.get<PaginatedResponse<Message>>(
    `/api/chat/rooms/${roomId}/messages/`,
    { params: { page } },
  );
  return data;
}

export async function addMemberToRoom(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/add-member/`, {
    user_id: userId,
  });
  return data;
}
