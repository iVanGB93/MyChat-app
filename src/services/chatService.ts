/* ------------------------------------------------------------------ */
/*  Chat API — rooms                                                   */
/* ------------------------------------------------------------------ */

import api from './api';
import type { ChatRoom } from '../types';
import { seedPresenceFromUsers, subscribePresenceUsers } from './presenceService';
import { refreshCollection, invalidateCollection } from './localFirstCollections';
import { getCachedRooms, cacheRooms } from './localMessageStore';

function seedRoomPresence(room: ChatRoom): ChatRoom {
  invalidateCollection('rooms');
  seedPresenceFromUsers(room.members_detail);
  return room;
}

export async function getRooms(force = false): Promise<ChatRoom[]> {
  const rooms = await refreshCollection<ChatRoom>({
    resource: 'rooms', syncUrl: '/api/chat/rooms/sync/', legacyUrl: '/api/chat/rooms/',
    id: (room) => room.id, read: getCachedRooms, save: cacheRooms, force,
  });
  subscribePresenceUsers(rooms.flatMap((room) => room.members_detail.map((member) => member.id)));
  return rooms;
}

export async function getOrCreateDirect(userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>('/api/chat/rooms/direct/', { user_id: userId });
  return seedRoomPresence(data);
}

export async function createGroupRoom(name: string, memberIds: number[]): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>('/api/chat/rooms/', {
    name,
    room_type: 'group',
    members: memberIds,
  });
  return seedRoomPresence(data);
}

export async function addMemberToRoom(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/add-member/`, {
    user_id: userId,
  });
  return seedRoomPresence(data);
}

export async function getRoom(roomId: string): Promise<ChatRoom> {
  const { data } = await api.get<ChatRoom>(`/api/chat/rooms/${roomId}/`);
  return seedRoomPresence(data);
}

export async function removeMemberFromRoom(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/remove-member/`, {
    user_id: userId,
  });
  return seedRoomPresence(data);
}

export async function renameGroupRoom(roomId: string, name: string): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/rename/`, { name });
  return seedRoomPresence(data);
}

export async function makeGroupAdmin(roomId: string, userId: number): Promise<ChatRoom> {
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/make-admin/`, {
    user_id: userId,
  });
  return seedRoomPresence(data);
}

/** Upload a replacement group photo selected from the device library. */
export async function uploadGroupAvatar(
  roomId: string,
  localUri: string,
  mimeType: string = 'image/jpeg',
): Promise<ChatRoom> {
  const extension = (mimeType.split('/')[1] || 'jpg').toLowerCase();
  const filename = localUri.split('/').pop() || `group-avatar.${extension}`;
  const form = new FormData();
  form.append('avatar', { uri: localUri, name: filename, type: mimeType } as any);
  const { data } = await api.post<ChatRoom>(`/api/chat/rooms/${roomId}/avatar/`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (request) => request,
  });
  return seedRoomPresence(data);
}

/**
 * Permanently delete a chat room. The backend cascades message deletion
 * and the room disappears for every member.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  await api.delete(`/api/chat/rooms/${roomId}/`);
  invalidateCollection('rooms');
}
