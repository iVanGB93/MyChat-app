import type {createRootChatLedger} from '../../services/identity/rootChatLedger';
import type {RootChatReply} from '../../services/identity/rootChatTypes';
import type {RootActionKind} from '../../services/identity/rootChatActionTypes';
import {rootChatView} from '../../services/identity/rootChatActions';

import type {PendingText} from './pendingMessages';
type Ledger = ReturnType<typeof createRootChatLedger>;
/** UI commands persist intent locally. They never require a connected peer. */
export function createMessagingCommands(d: {
  owner(): string | null;
  ledger(): Ledger;
  randomId(): Promise<string>;
  pending?(row:PendingText):()=>void;
  yieldUI?():Promise<void>;
}) {
  function session(expectedOwner?: string | null) {
    const owner = d.owner();
    if (!owner || expectedOwner !== undefined && owner !== expectedOwner) throw Error('Unlock your account and try again');
    const ledger = d.ledger();
    const check = () => { if (d.owner() !== owner) throw Error('Account changed'); };
    return {owner, ledger, check, async id() { const id = await d.randomId(); check(); return id; }};
  }
  return {
    async deleteChats(chats:string[],expectedOwner?:string|null) {
      const s=session(expectedOwner);return s.ledger.deleteChats(chats);
    },
    async sendText(peer: string, text: string, reply?: RootChatReply, expectedOwner?: string | null) {
      const started=Date.now(),s = session(expectedOwner), id = await s.id();
      const remove=d.pending?.({owner:s.owner,id,peer,text,reply,at:started});
      try{await d.yieldUI?.();s.check();await s.ledger.enqueue(peer,id,text,reply);return id;}
      catch(error){remove?.();throw error;}
    },
    async act(peer: string, target: RootChatReply, kind: RootActionKind, value = '', expectedOwner?: string | null) {
      const s = session(expectedOwner); await s.ledger.act(peer, await s.id(), target, kind, value);
    },
    async markRead(peers: string[]) {
      const s = session(), state = rootChatView(s.owner, await s.ledger.snapshot()); s.check();
      for (const peer of peers) {
        s.check();
        if (peer.startsWith('group:')) { await s.ledger.markGroupRead(peer.slice(6)); continue; }
        for (const m of state.messages.filter(m => !m.group && m.peer === peer && m.direction === 'incoming' && !m.read && !m.deleted)) {
          await s.ledger.act(peer, await s.id(), {id: m.id, author: peer}, 'read');
        }
      }
    },
    async readMessages(peer:string,ids:string[],expectedOwner?:string|null) {
      const s=session(expectedOwner),items=[];
      for(const id of ids.slice(0,20))items.push({id:await s.id(),target:{id,author:peer}});
      s.check();await s.ledger.readBatch(peer,items);
    },
    async createGroup(name: string, members: string[]) {
      const s = session(), id = await s.id(), packet = await s.id();
      await s.ledger.createGroup(id, packet, name, members); return id;
    },
    async updateGroup(group: string, name: string, members: string[], photo?:string|null) {
      const s = session(); await s.ledger.updateGroup(group, await s.id(), name, members,photo);
    },
    async leaveGroup(group: string) {
      const s = session(); await s.ledger.leaveGroup(group, await s.id());
    },
    async sendGroupText(group: string, text: string, reply?: RootChatReply, expectedOwner?: string | null) {
      const started=Date.now(),s = session(expectedOwner), id = await s.id();
      const remove=d.pending?.({owner:s.owner,id,peer:group,text,reply,group:true,at:started});
      try{await d.yieldUI?.();s.check();await s.ledger.enqueueGroup(group,id,text,reply);return id;}
      catch(error){remove?.();throw error;}
    },
    async actGroup(group: string, target: RootChatReply, kind: 'edit' | 'delete' | 'reaction', value = '', expectedOwner?: string | null) {
      const s = session(expectedOwner); await s.ledger.actGroup(group, await s.id(), target, kind, value);
    },
  };
}
