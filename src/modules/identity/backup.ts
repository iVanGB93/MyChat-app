import Native from '../../../modules/axonic-nearby';
import {hexToBytes} from '@noble/hashes/utils.js';
import {chooseBackupWords} from '../../services/identity/identityPresentation';

/** Backup confirmation randomness belongs to identity, not the login screen. */
export const backupWordPositions = (count: number) => chooseBackupWords(count, async size => hexToBytes(await Native!.identityRandomBytes!(size)));
