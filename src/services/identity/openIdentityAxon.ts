import {createPersistentAxon} from './persistentAxon';
import type {SecureRandom,UnlockedIdentity} from './identityVault';
import type {TestMessageHandler} from './axonTestMessages';

export interface ConnectionCredentialsSource {
  withConnectionCredentials<T>(revoke:()=>void,start:(
    credentials:Pick<UnlockedIdentity,'record'|'history'|'signingSeed'|'encryptionSeed'> & {
      instance:Uint8Array;now:()=>number;random:SecureRandom;current:()=>boolean;
    },release:()=>void,
  )=>T):Promise<T>;
}

type Options=Omit<Parameters<typeof createPersistentAxon>[0],
  'record'|'history'|'signingSeed'|'instance'|'now'|'random'|'current'|'testMessages'|'chatMessages'> & {
  onTestMessage?:TestMessageHandler;
  onChatMessage?:TestMessageHandler;
};

export async function openIdentityAxon(
  identity:ConnectionCredentialsSource,
  {onTestMessage,onChatMessage,onClosed,...options}:Options,
){
  let session:ReturnType<typeof createPersistentAxon>|undefined,closed=false;
  let release:(()=>void)|undefined;
  const close=()=>{
    if(closed)return;
    closed=true;release?.();session?.stop();
    try{options.wire.close();}catch{/* Release still completes. */}
    try{onClosed?.();}catch{/* Observer failures cannot retain a session. */}
  };
  try{
    return await identity.withConnectionCredentials(close,({encryptionSeed,...credentials},end)=>{
      release=end;
      session=createPersistentAxon({...options,...credentials,onClosed:close,
        testMessages:onTestMessage?{encryptionSeed,received:onTestMessage}:undefined,
        chatMessages:onChatMessage?{encryptionSeed,received:onChatMessage}:undefined,
      });
      if(closed)session.stop();
      return session;
    });
  }catch(error){close();throw error;}
}
