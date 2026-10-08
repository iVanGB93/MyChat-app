export type RootGroupContext={id:string;revision:number;messageId:string};
export type RootGroupMembership={id:string;admin:string;name:string;revision:number;members:string[]};
export type RootGroup=RootGroupMembership&{accepted:boolean;blocked:boolean};
export type RootGroupPacket={peer:string;id:string;raw:string;status:'pending'|'delivered'};

export type RootGroupAction={id:string;peer:string;direction:'incoming'|'outgoing';group:RootGroupContext;target:{id:string;author:string};kind:'edit'|'delete'|'reaction';revision:number;text:string;at:number;status:'pending'|'delivered'};
