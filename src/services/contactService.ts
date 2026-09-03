/* ------------------------------------------------------------------ */
/*  Contacts API                                                       */
/* ------------------------------------------------------------------ */

import api from './api';
import type { Contact, PaginatedResponse, User } from '../types';
import { seedPresenceFromUsers, subscribePresenceUsers } from './presenceService';
import { cacheAcceptedContact, cacheContacts, getCachedContacts } from './localMessageStore';
import { refreshCollection, invalidateCollection } from './localFirstCollections';
import { useAppStore } from '../store/appStore';

export async function getContacts(force = false): Promise<Contact[]> {
  const contacts = await refreshCollection<Contact>({
    resource: 'contacts', syncUrl: '/api/users/contacts/sync/', legacyUrl: '/api/users/contacts/',
    id: (contact) => String(contact.contact), read: getCachedContacts, save: cacheContacts, force,
  });
  subscribePresenceUsers(contacts.map((contact) => contact.contact));
  return contacts;
}

export async function addContact(contactUserId: number): Promise<Contact> {
  let contact: Contact;
  try {
    const { data } = await api.post<Contact>('/api/users/contacts/', { contact: contactUserId });
    contact = data;
  } catch (error: any) {
    const status = error?.response?.status;
    // A lost response or an older backend's duplicate-contact 500 is not
    // proof that acceptance failed. Confirm the exact contact with a read;
    // never treat validation/authentication errors as successful acceptance.
    if (status == null || status === 408 || status === 409 || status >= 500) {
      const existing = await getContacts(true).then(
        (contacts) => contacts.find((item) => item.contact === contactUserId),
        () => undefined,
      );
      if (!existing) throw error;
      contact = existing;
    } else {
      throw error;
    }
  }
  seedPresenceFromUsers([contact.contact_detail]);
  invalidateCollection('contacts');
  return contact;
}

/** Server acceptance is authoritative; a cache failure must not undo it. */
export async function acceptContact(ownerUserId: number, contactUserId: number): Promise<Contact> {
  const contact = await addContact(contactUserId);
  const store = useAppStore.getState();
  if (store.user?.id !== ownerUserId) throw new Error('Account changed during contact acceptance.');
  store.addContactId(contactUserId);
  try {
    await cacheAcceptedContact(ownerUserId, contact);
  } catch {
    // The next foreground contact refresh repairs both caches from the server.
    console.warn('[Contacts] Accepted contact; local cache will be repaired on refresh.');
  }
  return contact;
}

export function contactErrorMessage(error: any): string {
  const status = error?.response?.status;
  if (status === 400) {
    const detail = error.response?.data?.contact;
    const message = Array.isArray(detail) ? detail[0] : detail;
    if (typeof message === 'string') return message;
    return 'This contact could not be added. Please check the user and try again.';
  }
  if (status === 401) return 'Please sign in again to accept this chat.';
  if (status === 403) return 'You do not have permission to add this contact.';
  if (status == null || status === 408) return 'Please check your connection and try again.';
  return 'The server could not confirm this contact. Please try again shortly.';
}

export async function removeContact(contactId: number): Promise<void> {
  await api.delete(`/api/users/contacts/${contactId}/`);
  invalidateCollection('contacts');
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
  invalidateCollection('contacts');
  return data;
}

export async function unblockUser(blockRowId: number): Promise<void> {
  await api.delete(`/api/users/blocked/${blockRowId}/`);
  invalidateCollection('contacts');
}
