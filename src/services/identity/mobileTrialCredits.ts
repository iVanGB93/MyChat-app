import * as SQLite from 'expo-sqlite';
import {createTrialCredits,type TrialTransaction} from './trialCredits';
import {validAccountId} from './identityProtocol';
import {createChangeSignal} from './changeSignal';
const changes=createChangeSignal(0);export const subscribeTrialCredits=changes.subscribe;
let opening:Promise<SQLite.SQLiteDatabase>|undefined,tail:Promise<unknown>=Promise.resolve();
const instances=new Map<string,ReturnType<typeof createTrialCredits>>();
const db=()=>opening??=SQLite.openDatabaseAsync('axonic_trial_credits_v1.db',{useNewConnection:true}).then(async db=>{await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS trial_credits(owner TEXT NOT NULL,key TEXT NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(owner,key))');return db;}).catch(e=>{opening=undefined;throw e;});
export function mobileTrialCredits(owner:string){if(!validAccountId(owner))throw Error('Invalid credit owner');let ledger=instances.get(owner);if(ledger)return ledger;
 ledger=createTrialCredits({transaction<T>(work:(tx:TrialTransaction)=>T){const result=tail.then(async()=>{let value!:T;await(await db()).withExclusiveTransactionAsync(async tx=>{value=work({get:key=>{const r=tx.getFirstSync<{raw:string}>('SELECT raw FROM trial_credits WHERE owner=? AND key=?',owner,key);return r?JSON.parse(r.raw):null;},put:(key,value)=>{tx.runSync("INSERT INTO trial_credits(owner,key,raw) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET raw=excluded.raw WHERE key='balance'",owner,key,JSON.stringify(value));}});});return value;});tail=result.catch(()=>{});return result;}},changes.changed);instances.set(owner,ledger);void ledger.load();return ledger;
}
