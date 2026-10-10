import {Linking} from 'react-native';
/** Fixed public destinations; no account, identity or message data in URLs. */
export const appDestinations={privacy:'https://chat.qbared.com/privacy/',website:'https://chat.qbared.com/',store:'https://play.google.com/store/apps/details?id=com.axonic'} as const;
export async function openAppDestination(destination:keyof typeof appDestinations){
 const url=appDestinations[destination];if(!url)throw Error('Unknown app destination');await Linking.openURL(url);
}
