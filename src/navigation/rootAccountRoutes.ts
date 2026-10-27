export type RootAccountRoutes={Tabs:{screen:'Chats'|'Calls'|'Profile'}|undefined;ChatStorage:{peer?:string;group?:string}|undefined;BlockedUsers:undefined;GroupMessageInfo:{group:string;messageId:string;author:string};MessageInfo:{peer:string;id:string;direction:'incoming'|'outgoing'};OutgoingCall:{peer:string;kind:'voice'|'video'};ChatRoom:{peer:string};NewChat:{identity?:string}|undefined;Contact:{peer:string};Network:undefined;GroupCreate:undefined;GroupRoom:{id:string};GroupInfo:{id:string}};

/** Shared screen prop types; navigation does not implement screen behavior. */
export type RootAccountScreen<P extends keyof RootAccountRoutes> = import('@react-navigation/native-stack').NativeStackScreenProps<RootAccountRoutes,P>;
