/** Public identity/account boundary. Cryptographic implementations remain private adapters. */
export {localAccount, localAccountSession, localAccountUsername, localAccountBiometrics} from '../../services/identity/localAccount';
export {displayIdentity, shortIdentity, parseIdentityCode} from '../../services/identity/identityPresentation';
export {validAccountId} from '../../services/identity/identityProtocol';
export {checkBackupWords} from '../../services/identity/identityPresentation';
export {backupWordPositions} from './backup';
export {createMobileRecoveryDiscovery} from '../../services/identity/mobileRecoveryDiscovery';
export {checkRecoveryRecord,findRecoveryRecord} from '../../services/identity/recoveryDiscovery';
export {accountFromRecoveryPhrase} from '../../services/identity/identityVault';
export type {DirectoryLookupResult} from '../../services/identity/identityDirectoryLookup';
