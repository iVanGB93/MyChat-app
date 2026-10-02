export type TestRow = { owner: string; peer: string; direction: 'in' | 'out'; id: string;
  text: string; state: 'pending' | 'delivered'; created: number; attempts: number; next: number };
