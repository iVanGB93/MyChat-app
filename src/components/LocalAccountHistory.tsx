import React,{useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {archiveExistingLocalHistory} from '../services/identity/localAccountMigration';
import type {LegacyHistoryArchive} from '../services/identity/legacyHistoryArchive';

export default function LocalAccountHistory(){
 const [archive,setArchive]=useState<LegacyHistoryArchive|null>(null),[error,setError]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[attempt,setAttempt]=useState(0),[count,setCount]=useState(50);
 useEffect(()=>{let alive=true;setError('');
  void archiveExistingLocalHistory().then(value=>{if(alive)setArchive(value);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to read existing history');});
  return()=>{alive=false;};
 },[attempt]);
 const room=archive?.rooms.find(r=>r.room.id===selected);
 const text={color:'#c8d5e3',lineHeight:23};
 if(!archive&&!error)return null;
 return <View style={{gap:12}}><Text style={{color:'#fff',fontSize:21}}>Previous chats</Text>
  {!!error&&<><Text accessibilityRole="alert" style={{color:'#ffb4ab'}}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>setAttempt(n=>n+1)}><Text style={text}>Retry history import</Text></Pressable></>}
  <Text style={text}>Your earlier conversations are saved here. Pending messages are kept as history and are not sent again.</Text>
  {archive?.rooms.map(r=><Pressable key={r.room.id} accessibilityRole="button" onPress={()=>{setSelected(r.room.id);setCount(50);}}>
   <Text style={text}>{r.room.name||r.room.members_detail.filter(m=>m.id!==archive.owner).map(m=>m.display_name||m.username).join(', ')||'Previous chat'} · {r.messages.length} messages</Text>
  </Pressable>)}
  {room&&<><Text selectable style={text}>{room.peer?`Verified peer: ${room.peer}`:'Historical conversation — no verified direct peer link'}</Text>
   {room.messages.length>count&&<Pressable accessibilityRole="button" onPress={()=>setCount(n=>n+50)}><Text style={text}>Show earlier messages</Text></Pressable>}
   {room.messages.slice(-count).map(m=><View key={m.id} style={{padding:12,backgroundColor:m.is_mine?'#146b62':'#1c3540',borderRadius:12}}>
    <Text selectable style={text}>{m.is_deleted?'Message deleted':m.content||`[${m.type} attachment]`}</Text>
    <Text style={text}>{m.is_mine?'You':m.sender_name} · {m.status} · {new Date(m.created_at).toLocaleString()}</Text>
   </View>)}
  </>}
 </View>;
}
