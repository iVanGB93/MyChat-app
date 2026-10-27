import React from 'react';
import {Text, View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {shortIdentity} from '../../modules/identity';
import Avatar from '../../components/ui/Avatar';
import {useChatContacts} from '../../modules/ui/useChatSnapshot';

export default function ConnectedAxons({connections}: {
  connections: readonly {account: string; route: string; rank?:number; quality?:string; responseMs?:number|null}[];
}) {
  const {colors} = useTheme();
  const {contacts,hiddenChats}=useChatContacts();
  const names=React.useMemo(()=>Object.fromEntries(contacts.filter(c=>!hiddenChats?.includes(c.account)&&c.alias.trim()).map(c=>[c.account,c.alias])),[contacts,hiddenChats]);
  if (!connections.length) return null;
  return <View style={{marginTop: 12}}>
    {connections.map((connection, index) => {
      const identity = shortIdentity(connection.account), nickname = names[connection.account];
      const route = connection.route === 'lan' ? 'Nearby' : connection.route === 'private' ? 'Private network' : 'Internet';
      return <View key={`${connection.account}:${connection.route}:${index}`} style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.divider}}>
        <Avatar name={nickname || identity} size={40}/>
        <View style={{flex: 1}}>
          <Text style={{color: colors.text, fontSize: 16, fontWeight: '600'}}>{connection.rank ? `#${connection.rank} · ` : ''}{nickname || identity}</Text>
          {!!nickname && <Text style={{color: colors.textSecondary, fontSize: 13, marginTop: 3}}>{identity}</Text>}
          <Text style={{color: colors.textSecondary, fontSize: 13, marginTop: 3}}>{route} · {connection.quality==='measured'&&connection.responseMs!=null?`${connection.responseMs} ms response`:'Learning connection quality'}</Text>
        </View>
        <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online}}/>
      </View>;
    })}
  </View>;
}
