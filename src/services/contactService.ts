/* ------------------------------------------------------------------ */
/*  Contacts API                                                       */
/* ------------------------------------------------------------------ */

import api from './api';
import type { Contact, PaginatedResponse } from '../types';

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
