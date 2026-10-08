import React, {useCallback, useState} from 'react';
import {Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount, shortIdentity} from '../../modules/identity';
import {conversations, rootChatView} from '../../modules/messaging';
import Avatar from '../../components/ui/Avatar';

export default function ConnectedAxons({connections}: {
  connections: readonly {account: string; route: string}[];
}) {
  const {colors} = useTheme();
  const [names, setNames] = useState<Record<string, string>>({});
  useFocusEffect(useCallback(() => {
    let active = true, running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const owner = localAccount.status().account;
        if (!owner) {if (active) setNames({}); return;}
        const state = rootChatView(owner, await conversations().snapshot());
        if (active) setNames(Object.fromEntries(state.contacts
          .filter(contact => !state.hiddenChats?.includes(contact.account) && contact.alias.trim())
          .map(contact => [contact.account, contact.alias])));
      } catch {if (active) setNames({});}
      finally {running = false;}
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {active = false; clearInterval(timer);};
  }, []));
  if (!connections.length) return null;
  return <View style={{marginTop: 12}}>
    {connections.map((connection, index) => {
      const identity = shortIdentity(connection.account), nickname = names[connection.account];
      const route = connection.route === 'lan' ? 'Nearby' : connection.route === 'private' ? 'Private network' : 'Internet';
      return <View key={`${connection.account}:${connection.route}:${index}`} style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.divider}}>
        <Avatar name={nickname || identity} size={40}/>
        <View style={{flex: 1}}>
          <Text style={{color: colors.text, fontSize: 16, fontWeight: '600'}}>{nickname || identity}</Text>
          {!!nickname && <Text style={{color: colors.textSecondary, fontSize: 13, marginTop: 3}}>{identity}</Text>}
          <Text style={{color: colors.textSecondary, fontSize: 13, marginTop: 3}}>{route} · Connected</Text>
        </View>
        <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online}}/>
      </View>;
    })}
  </View>;
}
