/* ------------------------------------------------------------------ */
/*  Contacts API                                                       */
/* ------------------------------------------------------------------ */

import api from './api';
import type { Contact, PaginatedResponse, User } from '../types';

export async function getContacts(): Promise<Contact[]> {
  const { data } = await api.get<PaginatedResponse<Contact> | Contact[]>('/api/users/contacts/');
  // Handle both paginated and non-paginated responses
  if (Array.isArray(data)) return data;
  return data.results;
}

export async function addContact(contactUserId: number): Promise<Contact> {
  const { data } = await api.post<Contact>('/api/users/contacts/', { contact: contactUserId });
  return data;
}

export async function removeContact(contactId: number): Promise<void> {
  await api.delete(`/api/users/contacts/${contactId}/`);
}

/* ------------------------------------------------------------------ */
/*  Blocked users (Deny option on contact requests)                    */
/* ------------------------------------------------------------------ */

export interface BlockedUserRow {
  id: number;
  blocked: number;
  blocked_detail: User;
  created_at: string;
}

export async function getBlockedUsers(): Promise<BlockedUserRow[]> {
  const { data } = await api.get<PaginatedResponse<BlockedUserRow> | BlockedUserRow[]>(
    '/api/users/blocked/',
  );
  if (Array.isArray(data)) return data;
  return data.results;
}

export async function blockUser(userId: number): Promise<BlockedUserRow> {
  const { data } = await api.post<BlockedUserRow>('/api/users/blocked/', { blocked: userId });
  return data;
}

export async function unblockUser(blockRowId: number): Promise<void> {
  await api.delete(`/api/users/blocked/${blockRowId}/`);
}
