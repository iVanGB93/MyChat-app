/* ------------------------------------------------------------------ */
/*  Chat API — rooms                                                   */
/* ------------------------------------------------------------------ */

import api from './api';
import type { ChatRoom, PaginatedResponse } from '../types';

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

export async function addMemberToRoom(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/add-member/`, {
    user_id: userId,
  });
  return data;
}

export async function getRoom(roomId: string): Promise<ChatRoom> {
  const { data } = await api.get<ChatRoom>(`/api/chat/rooms/${roomId}/`);
  return data;
}

export async function removeMemberFromRoom(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/remove-member/`, {
    user_id: userId,
  });
  return data;
}

export async function renameGroupRoom(roomId: string, name: string): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/rename/`, { name });
  return data;
}

export async function makeGroupAdmin(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/make-admin/`, {
    user_id: userId,
  });
  return data;
}

/**
 * Permanently delete a chat room. The backend cascades message deletion
 * and the room disappears for every member.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  await api.delete(`/api/chat/rooms/${roomId}/`);
}
