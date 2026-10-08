export type RootActionKind = 'edit' | 'delete' | 'reaction' | 'read';
export type RootChatAction = { id: string; peer: string; direction: 'incoming' | 'outgoing'; target: {id:string;author:string}; kind: RootActionKind; revision: number; text: string; at: number; status: 'pending' | 'delivered' };
