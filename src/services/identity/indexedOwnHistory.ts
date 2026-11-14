import type {OwnHistoryScope,OwnHistorySlice} from './ownHistoryStore.ts';
import type {RootChatState} from './rootChatTypes.ts';
const collections=['messages','actions','groupActions','groupPackets','groupSeen'] as const;
type Collection=typeof collections[number];
type Row={collection:Collection;key:string;position:number;raw:string;peer:string;id:string;direction:string;status:string;groupId:string;targetId:string};
export interface HistorySQL {
 execAsync(sql:string):Promise<unknown>;
 getFirstAsync<T>(sql:string,...values:any[]):Promise<T|null>;
 getAllAsync<T>(sql:string,...values:any[]):Promise<T[]>;
 runAsync(sql:string,...values:any[]):Promise<unknown>;
}
export const indexedHistorySchema=`
 CREATE TABLE IF NOT EXISTS own_history_accounts(owner TEXT PRIMARY KEY,version INTEGER NOT NULL,metadata TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS own_history_records(owner TEXT NOT NULL,collection TEXT NOT NULL,row_key TEXT NOT NULL,position INTEGER NOT NULL,raw TEXT NOT NULL,peer TEXT NOT NULL,id TEXT NOT NULL,direction TEXT NOT NULL,status TEXT NOT NULL,group_id TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(owner,collection,row_key));
 CREATE INDEX IF NOT EXISTS own_history_target ON own_history_records(owner,peer,id);
 CREATE INDEX IF NOT EXISTS own_history_action_target ON own_history_records(owner,peer,target_id);
 CREATE INDEX IF NOT EXISTS own_history_pending ON own_history_records(owner,status,direction);
 CREATE INDEX IF NOT EXISTS own_history_attachment ON own_history_records(owner,collection,(json_type(raw,'$.attachment') IS NOT NULL));
 CREATE INDEX IF NOT EXISTS own_history_logical ON own_history_records(owner,(json_extract(raw,'$.group.messageId')));
 CREATE INDEX IF NOT EXISTS own_history_group_action_target ON own_history_records(owner,group_id,target_id);
 CREATE INDEX IF NOT EXISTS own_history_room ON own_history_records(owner,group_id,peer);
`;
function split(s:RootChatState){
 const meta:any={...s},rows:Row[]=[];const fields:string[]=[];
 for(const collection of collections){const values=(s as any)[collection];delete meta[collection];if(values===undefined)continue;if(!Array.isArray(values))throw Error('Invalid history collection');fields.push(collection);
  const seen=new Set<string>();values.forEach((v:any,position:number)=>{const key=JSON.stringify([v.direction??'',v.peer,v.id]);if(seen.has(key))throw Error('Duplicate history record; needs recovery');seen.add(key);rows.push({collection,key,position,raw:JSON.stringify(v),peer:v.peer,id:v.id,direction:v.direction??'',status:v.status??'',groupId:v.group?.id??'',targetId:v.target?.id??''});});
 }
 return {metadata:JSON.stringify({state:meta,fields}),rows};
}
/** Canonical record store. All operations share the injected connection's queue. */
export function createIndexedOwnHistory(owner:string,d:{sql:HistorySQL;legacy():Promise<string|null>;validate(raw:string):RootChatState;current?():boolean}){
 const db=d.sql;let tail:Promise<unknown>=Promise.resolve(),initialized=false;
 const metrics={fullReads:0,selectedReads:0,networkReads:0,rowsRead:0,rowsWritten:0,migrations:0};
 const current=()=>{if(d.current&&!d.current())throw Error('Unlock your account first');};
 function serial<T>(work:()=>Promise<T>){const result=tail.then(work);tail=result.catch(()=>{});return result;}
 async function transaction<T>(work:()=>Promise<T>){await db.execAsync('BEGIN IMMEDIATE');try{const result=await work();current();await db.execAsync('COMMIT');return result;}catch(e){await db.execAsync('ROLLBACK');throw e;}}
 async function account(){const row=await db.getFirstAsync<{version:number;metadata:string}>('SELECT version,metadata FROM own_history_accounts WHERE owner=?',owner);if(!row)throw Error('Indexed history needs recovery');return row;}
 async function put(row:Row){await db.runAsync('INSERT OR REPLACE INTO own_history_records(owner,collection,row_key,position,raw,peer,id,direction,status,group_id,target_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',owner,row.collection,row.key,row.position,row.raw,row.peer,row.id,row.direction,row.status,row.groupId,row.targetId);metrics.rowsWritten++;}
 async function ensure(){current();if(initialized)return;await db.execAsync(indexedHistorySchema);
  if(!await db.getFirstAsync('SELECT owner FROM own_history_accounts WHERE owner=?',owner)){
   const raw=await d.legacy();current();const state=d.validate(raw??'{"version":1,"contacts":[],"messages":[]}'),parts=split(state);
   await transaction(async()=>{if(await db.getFirstAsync('SELECT owner FROM own_history_accounts WHERE owner=?',owner))return;for(const row of parts.rows)await put(row);await db.runAsync('INSERT INTO own_history_accounts(owner,version,metadata) VALUES(?,?,?)',owner,1,parts.metadata);metrics.migrations++;});
  }initialized=true;
 }
 function assemble(metadata:string,rows:{collection:string;raw:string}[]){const meta=JSON.parse(metadata);if(!meta.state||!Array.isArray(meta.fields)||meta.fields.some((k:string)=>!collections.includes(k as Collection)))throw Error('Indexed history needs recovery');const state:any={...meta.state};for(const key of meta.fields)state[key]=[];for(const row of rows){if(!collections.includes(row.collection as Collection)||!Array.isArray(state[row.collection]))throw Error('Indexed history needs recovery');state[row.collection].push(JSON.parse(row.raw));}return JSON.stringify(state);}
 async function records(where='',args:any[]=[]){const rows=await db.getAllAsync<{collection:Collection;row_key:string;position:number;raw:string}>('SELECT collection,row_key,position,raw FROM own_history_records WHERE owner=? '+where+' ORDER BY collection,position',owner,...args);metrics.rowsRead+=rows.length;return rows;}
 function predicate(scope:OwnHistoryScope){if('metadata' in scope)return {where:'AND 0',args:[]};if('deliveryIds' in scope){if(scope.deliveryIds.length>5000)throw Error('Invalid delivery selection');return {where:'AND id IN (SELECT value FROM json_each(?))',args:[JSON.stringify(scope.deliveryIds)]};}if('control' in scope)return {where:"AND (collection='groupPackets' OR (peer=? AND id=?) OR (?<>'' AND group_id=? AND (json_extract(raw,'$.group.messageId')=? OR target_id=?)) OR (direction='outgoing' AND collection IN ('messages','actions') AND EXISTS (SELECT 1 FROM own_history_records p WHERE p.owner=own_history_records.owner AND p.collection='groupPackets' AND p.peer=own_history_records.peer AND p.id=own_history_records.id)))",args:[scope.incomingPeer??'',scope.incomingId??'',scope.photoId??'',scope.photoGroup??'',scope.photoId??'',scope.photoId??'']};if('groupRead' in scope)return {where:"AND group_id=? AND (collection='groupActions' OR (collection='messages' AND direction='incoming' AND COALESCE(json_extract(raw,'$.read'),0)=0))",args:[scope.groupRead]};if('group' in scope){if(!scope.ids.length||scope.ids.length>64||!scope.logicalIds.length||scope.logicalIds.length>16)throw Error('Invalid group selection');if(scope.actionTarget)return {where:"AND (id IN (SELECT value FROM json_each(?)) OR (collection='groupActions' AND json_extract(raw,'$.group.messageId') IN (SELECT value FROM json_each(?))) OR (group_id=? AND ((collection='messages' AND json_extract(raw,'$.group.messageId')=?) OR (collection='groupActions' AND target_id=?))))",args:[JSON.stringify(scope.ids),JSON.stringify(scope.logicalIds),scope.group,scope.actionTarget,scope.actionTarget]};return {where:`AND (group_id=? OR id IN (${scope.ids.map(()=>'?').join(',')}) OR json_extract(raw,'$.group.messageId') IN (${scope.logicalIds.map(()=>'?').join(',')}))`,args:[scope.group,...scope.ids,...scope.logicalIds]};}if(!scope.ids.length||scope.ids.length>64)throw Error('Invalid history selection');const q=scope.ids.map(()=>'?').join(',');return {where:`AND peer=? AND (id IN (${q}) OR target_id IN (${q}))`,args:[scope.peer,...scope.ids,...scope.ids]};}
 async function readScope(scope:OwnHistoryScope){await ensure();const a=await account(),p=predicate(scope),rows=await records(p.where,p.args);current();metrics.selectedReads++;return {raw:assemble(a.metadata,rows),version:a.version,counts:{}};}

 async function commitScope(scope:OwnHistoryScope,before:OwnHistorySlice,raw:string){await ensure();const state=d.validate(raw),parts=split(state),previous=split(d.validate(before.raw)),old=new Map(previous.rows.map(r=>[r.collection+':'+r.key,r]));
  if('metadata' in scope&&parts.rows.length)throw Error('History selection violation');
  for(const row of parts.rows){const prior=old.get(row.collection+':'+row.key);const allowed='metadata' in scope?false:'deliveryIds' in scope?scope.deliveryIds.includes(row.id):'control' in scope?['groupPackets','groupSeen'].includes(row.collection)||prior?.raw===row.raw:'groupRead' in scope?row.groupId===scope.groupRead&&['messages','groupActions'].includes(row.collection):'group' in scope?row.groupId===scope.group||scope.ids.includes(row.id)||scope.logicalIds.includes(JSON.parse(row.raw).group?.messageId):row.peer===scope.peer&&(scope.ids.includes(row.id)||scope.ids.includes(row.targetId));if(!allowed)throw Error('History selection violation');}

  if('control' in scope){const current=new Map(parts.rows.map(r=>[r.collection+':'+r.key,r.raw]));for(const row of previous.rows)if(!['groupPackets','groupSeen'].includes(row.collection)&&current.get(row.collection+':'+row.key)!==row.raw)throw Error('Read-only conflict or photo record changed');}
  await transaction(async()=>{const a=await account();if(a.version!==before.version)throw Error('History changed; retry');const fields=new Set(JSON.parse(a.metadata).fields);for(const f of JSON.parse(parts.metadata).fields)fields.add(f);const metadata=JSON.stringify({state:JSON.parse(parts.metadata).state,fields:[...fields]});
   for(const row of parts.rows){const key=row.collection+':'+row.key,prior=old.get(key);old.delete(key);if(prior?.raw===row.raw)continue;
    // Sparse control/read mutations still check conflicts against omitted history.
    if(('control' in scope&&row.collection==='groupPackets')||('groupRead' in scope&&row.collection==='groupActions')){
     const conflict=await db.getFirstAsync("SELECT 1 FROM own_history_records WHERE owner=? AND peer=? AND id=? AND ((direction='outgoing' AND collection IN ('messages','actions')) OR (?='groupActions' AND collection='groupPackets')) LIMIT 1",owner,row.peer,row.id,row.collection);if(conflict)throw Error('Group packet or action ID conflict');
     if(row.collection==='groupActions'){const logical=JSON.parse(row.raw).group.messageId;const conflict=await db.getFirstAsync("SELECT 1 FROM own_history_records WHERE owner=? AND collection='groupActions' AND direction='outgoing' AND json_extract(raw,'$.group.messageId')=? AND group_id<>? LIMIT 1",owner,logical,row.groupId);if(conflict)throw Error('Group action ID conflict');}
    }
    const stored=await db.getFirstAsync<{position:number}>('SELECT position FROM own_history_records WHERE owner=? AND collection=? AND row_key=?',owner,row.collection,row.key);
    const last=stored??await db.getFirstAsync<{position:number}>('SELECT COALESCE(MAX(position),-1)+1 AS position FROM own_history_records WHERE owner=? AND collection=?',owner,row.collection);await put({...row,position:last!.position});}
   for(const row of old.values())await db.runAsync('DELETE FROM own_history_records WHERE owner=? AND collection=? AND row_key=?',owner,row.collection,row.key);
   await db.runAsync('UPDATE own_history_accounts SET metadata=?,version=version+1 WHERE owner=?',metadata,owner);
  });
 }
 return {
  diagnostics:()=>({...metrics}),
  read:()=>serial(async()=>{await ensure();const a=await account(),rows=await records();current();metrics.fullReads++;return assemble(a.metadata,rows);}),
  write:(raw:string)=>serial(async()=>{await ensure();const parts=split(d.validate(raw));await transaction(async()=>{const old=await records(),wanted=new Set(parts.rows.map(r=>r.collection+':'+r.key)),byKey=new Map(old.map(r=>[r.collection+':'+r.row_key,r]));for(const row of parts.rows){const prior=byKey.get(row.collection+':'+row.key);if(prior?.raw!==row.raw||prior.position!==row.position)await put(row);}for(const row of old)if(!wanted.has(row.collection+':'+row.row_key))await db.runAsync('DELETE FROM own_history_records WHERE owner=? AND collection=? AND row_key=?',owner,row.collection,row.row_key);await db.runAsync('UPDATE own_history_accounts SET metadata=?,version=version+1 WHERE owner=?',parts.metadata,owner);});}),
  readScope:(scope:OwnHistoryScope)=>serial(()=>readScope(scope)),
  writeScope:(scope:OwnHistoryScope,before:OwnHistorySlice,raw:string)=>serial(()=>commitScope(scope,before,raw)),
  readMedia:()=>serial(async()=>{await ensure();const a=await account(),media="(json_type(m.raw,'$.attachment') IS NOT NULL OR json_type(m.raw,'$.retiredAttachment') IS NOT NULL)",rows=await records("AND collection='messages' AND (json_type(raw,'$.attachment') IS NOT NULL OR json_type(raw,'$.retiredAttachment') IS NOT NULL)");
   for(const kind of ['actions','groupActions']){const on=kind==='actions'?"a.peer=m.peer AND a.target_id=m.id AND m.group_id=''":"a.group_id=m.group_id AND a.target_id=json_extract(m.raw,'$.group.messageId') AND m.group_id<>''";
    const events=await db.getAllAsync<{collection:Collection;row_key:string;position:number;raw:string}>("SELECT DISTINCT a.collection,a.row_key,a.position,a.raw FROM own_history_records m JOIN own_history_records a ON a.owner=m.owner AND a.collection=? AND "+on+" WHERE m.owner=? AND m.collection='messages' AND "+media+" ORDER BY a.position",kind,owner);metrics.rowsRead+=events.length;rows.push(...events);
   }current();return assemble(a.metadata,rows);}),
  readUnread:(peers:string[])=>serial(async()=>{await ensure();const a=await account(),rows=await records("AND peer IN (SELECT value FROM json_each(?)) AND ((collection='messages' AND group_id='' AND direction='incoming' AND COALESCE(json_extract(raw,'$.read'),0)=0) OR (collection='actions' AND EXISTS (SELECT 1 FROM own_history_records m WHERE m.owner=own_history_records.owner AND m.collection='messages' AND m.group_id='' AND m.direction='incoming' AND COALESCE(json_extract(m.raw,'$.read'),0)=0 AND m.peer=own_history_records.peer AND m.id=own_history_records.target_id)))",[JSON.stringify(peers)]);current();return assemble(a.metadata,rows);}),
  readAttachments:()=>serial(async()=>{await ensure();const a=await account(),rows=await records("AND collection='messages' AND json_type(raw,'$.attachment') IS NOT NULL");current();return assemble(a.metadata,rows);}),
  readId:(id:string)=>serial(async()=>{await ensure();const a=await account(),rows=await records('AND (id=? OR target_id=?)',[id,id]);current();return assemble(a.metadata,rows);}),
  readGroup:(group:string,logicalId?:string)=>serial(async()=>{await ensure();const a=await account(),messages=await records("AND collection='messages' AND group_id=? AND "+(logicalId!==undefined?"json_extract(raw,'$.group.messageId')=?":"json_type(raw,'$.attachment') IS NOT NULL"),logicalId!==undefined?[group,logicalId]:[group]);
   const ids=[...new Set(messages.map(m=>JSON.parse(m.raw).group.messageId))],actions=ids.length?await records("AND collection='groupActions' AND group_id=? AND target_id IN (SELECT value FROM json_each(?))",[group,JSON.stringify(ids)]):[];current();return assemble(a.metadata,[...messages,...actions]);}),
  readMessage:(peer:string,id:string,direction:'incoming'|'outgoing'='incoming')=>serial(async()=>{await ensure();const a=await account(),messages=await records("AND collection='messages' AND peer=? AND id=? AND direction=?",[peer,id,direction]);const target=messages.map(r=>JSON.parse(r.raw)).find(m=>m.direction===direction);let actions:Awaited<ReturnType<typeof records>>=[];if(target){actions=target.group?await records("AND collection='groupActions' AND group_id=? AND target_id=?",[target.group.id,target.group.messageId]):await records("AND collection='actions' AND peer=? AND target_id=?",[peer,id]);}current();return assemble(a.metadata,[...messages,...actions]);}),
  readNetwork:()=>serial(async()=>{await ensure();const a=await account(),rows=await records("AND status='pending' AND (direction='outgoing' OR collection='groupPackets')");current();metrics.networkReads++;return assemble(a.metadata,rows);}),
  readRooms:(rooms:string[])=>serial(async()=>{await ensure();const a=await account();if(!rooms.length)return assemble(a.metadata,[]);const terms:string[]=[],args:string[]=[];for(const room of rooms){if(room.startsWith('group:')){terms.push('group_id=?');args.push(room.slice(6));}else{terms.push("(peer=? AND group_id='')");args.push(room);}}return assemble(a.metadata,await records("AND collection IN ('messages','actions','groupActions') AND ("+terms.join(' OR ')+')',args));}),
  recordKnown:(peer:string,id:string,kind:'incoming'|'outgoing'|'groupOutgoing')=>serial(async()=>{await ensure();const where=kind==='incoming'?"(direction='incoming' OR collection='groupSeen')":kind==='groupOutgoing'?"direction='outgoing' AND collection IN ('messages','groupActions')":"(direction='outgoing' OR collection='groupPackets')";const row=await db.getFirstAsync('SELECT 1 FROM own_history_records WHERE owner=? AND peer=? AND id=? AND '+where+' LIMIT 1',owner,peer,id);current();return !!row;}),
 };
}
