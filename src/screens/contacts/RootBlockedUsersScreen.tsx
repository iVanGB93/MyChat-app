import {useChatSnapshot as useOwnChat} from '../../modules/ui/useChatSnapshot';
import {ThemedAlert as Alert} from '../../components/ui/ThemedAlert';
import {contactListStyles as contactStyles} from './contact-list-styles';
import {shortIdentity} from '../../modules/identity';
import {FlatList,Text,TouchableOpacity,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import {conversations} from '../../modules/messaging';
import {report} from '../rootScreenSupport';
export default function BlockedUsers(){const {colors}=useTheme(),{state}=useOwnChat();return <FlatList style={{flex:1,backgroundColor:colors.background}} data={state.contacts.filter(c=>c.blocked)} keyExtractor={c=>c.account} contentContainerStyle={state.contacts.some(c=>c.blocked)?contactStyles.list:contactStyles.emptyContainer} ListEmptyComponent={<EmptyState iconName="ban-outline" title="No blocked users"/>} renderItem={({item:c})=><View style={contactStyles.item}><Avatar name={c.alias||shortIdentity(c.account)} uri={state.avatarUris[c.account]} size={46}/><View style={contactStyles.info}><Text style={[contactStyles.name,{color:colors.text}]}>{c.alias||shortIdentity(c.account)}</Text><Text style={[contactStyles.sub,{color:colors.textSecondary}]}>{shortIdentity(c.account)}</Text></View><TouchableOpacity accessibilityLabel="Unblock user" onPress={()=>Alert.alert('Unblock user?',`Unblock ${c.alias||shortIdentity(c.account)}? They will be able to message and call you again.`,[{text:'Cancel',style:'cancel'},{text:'Unblock',onPress:()=>void conversations().configure(c.account,{blocked:false}).catch(report)}])}><Text style={{color:colors.primary}}>Unblock</Text></TouchableOpacity></View>}/>;}
