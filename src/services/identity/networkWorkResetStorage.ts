import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import notifee from '@notifee/react-native';
import {ownChatStore} from '../../modules/storage/chatStore';
import {createRootChatLedger} from './rootChatLedger';
import {networkResetKeys,networkResetTables,parseNetworkReset,type NetworkResetIntent} from './networkWorkReset';
/** Cold startup only. Never delete directories or downloaded media. */
export async function purgeNetworkWork(input:NetworkResetIntent){
 const {account,at}=parseNetworkReset(JSON.stringify(input));
 // Validate existing history first. Never replace unreadable history with an empty ledger.
 const ledger=createRootChatLedger({owner:account,...ownChatStore(account),now:()=>at,current:()=>true});
 await ledger.cancelNetworkWork(at);
 for(const file of new Set(networkResetTables.map(r=>r[0]))){
  const db=await SQLite.openDatabaseAsync(file,{useNewConnection:true});
  try{await db.withExclusiveTransactionAsync(async tx=>{
   for(const [name,table] of networkResetTables)if(name===file&&await tx.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table))await tx.runAsync(`DELETE FROM ${table} WHERE owner=?`,account);
  });}finally{await db.closeAsync();}
 }
 // Retire signaling without erasing the user's call history or replay protection.
 const db=await SQLite.openDatabaseAsync('axonic_call_control_v1.db',{useNewConnection:true});
 try{await db.withExclusiveTransactionAsync(async tx=>{
  if(!await tx.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='call_journal'"))return;
  await tx.execAsync('CREATE TABLE IF NOT EXISTS call_history(owner TEXT NOT NULL,call_id TEXT NOT NULL,data TEXT NOT NULL,archived_at INTEGER NOT NULL,PRIMARY KEY(owner,call_id));');
  await tx.runAsync('INSERT OR IGNORE INTO call_history(owner,call_id,data,archived_at) SELECT owner,call_id,data,? FROM call_journal WHERE owner=?',at,account);
  await tx.runAsync('DELETE FROM call_journal WHERE owner=?',account);
 });}finally{await db.closeAsync();}
 await AsyncStorage.multiRemove(networkResetKeys(account));
 for(const n of await notifee.getDisplayedNotifications())if(n.notification.data?.account===account&&n.notification.id)await notifee.cancelNotification(n.notification.id);
 // Keep a local measurement boundary; diagnostics distinguish cancellation from loss.
 await AsyncStorage.setItem('@axonic_last_network_reset_v1:'+account,JSON.stringify({at,scope:'local-network-work'}));
}
