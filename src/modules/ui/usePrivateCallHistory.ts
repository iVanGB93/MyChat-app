import {useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useForegroundEvents} from '../../hooks/useForegroundEvents';
import {localAccount} from '../identity';
import {listOwnCallHistory,subscribeCallJournalWrites,type OwnCallSummary} from '../storage';
export function usePrivateCallHistory(peer:string,group=false){
 const focused=useIsFocused(),owner=localAccount.status().state==='unlocked'?localAccount.status().account:null,key=owner+':'+(group?'group:':'')+peer;
 const [result,setResult]=useState<{key:string;rows:OwnCallSummary[];error:string}>({key:'',rows:[],error:''});
 useForegroundEvents(async current=>{if(!owner)return;try{const rows=await listOwnCallHistory(owner,group?undefined:peer,group?peer:undefined);if(current()&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner)setResult(old=>old.key===key&&JSON.stringify(old.rows)===JSON.stringify(rows)&&!old.error?old:{key,rows,error:''});}
 catch(error){if(current())setResult(old=>({key,rows:old.key===key?old.rows:[],error:'Unable to read call history'}));throw error;}},subscribeCallJournalWrites,focused&&!!owner,key);
 return result.key===key?result:{key,rows:[],error:''};
}
