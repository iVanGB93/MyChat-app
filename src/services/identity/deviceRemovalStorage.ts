import AsyncStorage from '@react-native-async-storage/async-storage';
import {clearChatRecoverySnapshot} from '../../../modules/axonic-app-update/src';
import * as SQLite from 'expo-sqlite';
import {Directory,File,Paths} from 'expo-file-system';
import notifee from '@notifee/react-native';
import {validAccountId} from './identityProtocol';
import {deviceRemovalKeys,deviceRemovalTables} from './deviceRemoval';
/** Only called on cold startup before credentials, delivery workers or UI data load. */
export async function purgeDeviceAccountData(account:string){
 if(!validAccountId(account))throw Error('Invalid removal account');
 // Fixed table/column names; the account is always bound, never interpolated.
 for(const file of new Set(deviceRemovalTables.map(r=>r[0]))){
  const db=await SQLite.openDatabaseAsync(file,{useNewConnection:true});
  try{await db.withExclusiveTransactionAsync(async tx=>{
   for(const [name,table,column] of deviceRemovalTables)if(name===file){
    if(await tx.getFirstAsync('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?',table))await tx.runAsync(`DELETE FROM ${table} WHERE ${column}=?`,account);
   }
  });}finally{await db.closeAsync();}
 }
 const hash=account.slice(9);
 for(const parts of [['axonic-own-attachments-v1',hash],['axonic-sticker-drafts-v1',hash],['stickers','root-'+hash]]){
  const directory=new Directory(Paths.document,...parts);if(directory.exists)directory.delete();
 }
 const profiles=new Directory(Paths.document,'root-profiles');
 if(profiles.exists)for(const item of profiles.list())if(item instanceof File&&new RegExp('^'+hash+'-[0-9]+\\.jpg$').test(item.name))item.delete();
 await AsyncStorage.multiRemove(deviceRemovalKeys(await AsyncStorage.getAllKeys(),account));
 // This full-database rescue copy may contain the removed account. Other live
 // accounts remain untouched; an explicit account removal retires the rescue copy.
 await clearChatRecoverySnapshot();
 // Do not remove shared gallery exports, public network directories, other accounts, or app settings.
 const notices=await notifee.getDisplayedNotifications();for(const n of notices)if(n.notification.data?.account===account&&n.notification.id)await notifee.cancelNotification(n.notification.id);
}
