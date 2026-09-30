import { fetch } from 'expo/fetch';
import { createIdentityHttpTransport } from './identityHttpTransport';

/** Streamed native client. Cleartext LAN access is not enabled by this adapter. */
export const mobileIdentityHttpTransport = (endpoint: string) => createIdentityHttpTransport(endpoint, fetch);
