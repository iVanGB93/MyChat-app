/** Coalesce receipt bursts without detaching work from a headless task. */
import api from './api';

interface Receipt {
  message_id: string;
  sender_id: number;
  room_id: string;
  delivered_at?: string;
  device_id?: string;
}
interface Result { status: number; data: { status?: string } }
interface Pending { receipt: Receipt; resolve: (value: Result) => void; reject: (error: unknown) => void }
let waiting: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function sendMessageAck(receipt: Receipt): Promise<Result> {
  return new Promise((resolve, reject) => {
    waiting.push({ receipt, resolve, reject });
    if (!timer) timer = setTimeout(() => { void flush(); }, 20);
  });
}

async function individually(batch: Pending[]): Promise<void> {
  // Older backends do not know the batch endpoint. Keep fallback bounded.
  for (let offset = 0; offset < batch.length; offset += 5) {
    await Promise.all(batch.slice(offset, offset + 5).map(async (item) => {
      try { item.resolve(await api.post('/api/chat/messages/ack/', item.receipt)); }
      catch (error) { item.reject(error); }
    }));
  }
}

async function flush(): Promise<void> {
  timer = null;
  const batch = waiting.splice(0, 100);
  if (waiting.length) timer = setTimeout(() => { void flush(); }, 20);
  if (batch.length <= 1) return individually(batch);
  try {
    const { data } = await api.post('/api/chat/messages/ack-batch/', { receipts: batch.map((item) => item.receipt) });
    if (!Array.isArray(data?.results) || data.results.length !== batch.length) throw new Error('Invalid batch receipt response.');
    for (let index = 0; index < batch.length; index++) {
      const result = data.results[index];
      if (result.message_id !== batch[index].receipt.message_id) {
        batch[index].reject(new Error('Mismatched receipt response.'));
      } else {
        batch[index].resolve({ status: result.http_status, data: { status: result.status } });
      }
    }
  } catch (error: any) {
    if ([404, 405].includes(error?.response?.status)) await individually(batch);
    else for (const item of batch) item.reject(error);
  }
}
