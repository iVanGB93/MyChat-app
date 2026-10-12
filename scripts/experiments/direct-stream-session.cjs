// Laboratory-only session. Caller must provide a reliable ordered DTLS channel
// bound to the expected peer's signed SDP. Not imported by the application.
function createDirectStreamSession(d) {
  const MAX = 8 * 1024 * 1024, WINDOW = 256 * 1024;
  let dead = false, incoming = null, outgoing = null, queued = 0, tail = Promise.resolve();
  const results = [];
  const validId = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  function current() { if (dead || !d.live()) throw Error('Direct session unavailable'); }
  function control(value) { current(); d.send(JSON.stringify(value)); }
  function abort(reason) {
    if (dead) return; dead = true;
    try { incoming?.file.close(); } catch {}
    try { outgoing?.file?.close(); } catch {}
    if(outgoing)outgoing.file=null;
    if (incoming) try { d.remove(incoming.id); } catch {}
    incoming = null;
    d.close();
    results.push({error:String(reason)});
  }
  async function receive(data) {
    current();
    const size = typeof data === 'string' ? data.length : data instanceof ArrayBuffer ? data.byteLength : Infinity;
    if (size < 1 || size > (typeof data === 'string' ? 1024 : 65536) || queued + size > WINDOW + 2048) {
      abort('Receive bound exceeded'); throw Error('Receive bound exceeded');
    }
    queued += size;
    const task = tail.then(async () => {
      current();
      if (typeof data !== 'string') {
        const r = incoming;
        if (!r || r.received + size > r.bytes || size !== Math.min(r.frameBytes, r.bytes - r.received)) throw Error('Unexpected stream bytes');
        r.file.write(new Uint8Array(data)); r.received += size;
        if (r.received === r.bytes) {
          r.file.close(); r.file = {close(){}};
          const hash = await d.hash(r.id, r.bytes); current();
          if (hash !== r.hash) throw Error('File hash mismatch');
          control({kind:'complete',id:r.id,bytes:r.bytes,hash});
          results.push({id:r.id,bytes:r.bytes,verified:true}); incoming = null;
        } else if (r.received - r.ack >= WINDOW / 2) {
          r.ack = r.received; control({kind:'ack',id:r.id,offset:r.received});
        }
      } else {
        const m = JSON.parse(data);
        if (m.kind === 'start') {
          if (incoming || outgoing || !validId(m.id) || !validId(m.hash) || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > MAX || ![16384,65536].includes(m.frameBytes)) throw Error('Invalid stream offer');
          incoming = {...m, received:0,ack:0,file:d.writer(m.id)};
          control({kind:'ready',id:m.id});
        } else {
          const s = outgoing;
          if (!s || m.id !== s.id) throw Error('Unexpected stream control');
          if (m.kind === 'ready' && !s.ready) s.ready = true;
          else if (m.kind === 'ack' && s.ready && Number.isSafeInteger(m.offset) && m.offset > s.ack && m.offset <= s.sent) s.ack = m.offset;
          else if (m.kind === 'complete' && s.ready && s.sent === s.bytes && m.bytes === s.bytes && m.hash === s.hash) s.complete = true;
          else throw Error('Invalid stream receipt');
        }
      }
    }).catch(error => { abort(error); throw error; }).finally(() => { queued -= size; });
    tail = task.catch(()=>{}); return task;
  }
  async function send(id,bytes,frameBytes) {
    current();
    if (incoming || outgoing || !validId(id) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX || ![16384,65536].includes(frameBytes)) throw Error('Invalid send');
    const started = d.now(), s = outgoing = {id,bytes,frameBytes,ack:0,sent:0,ready:false,complete:false,file:null,hash:null};
    try {
      s.hash = await d.hash(id,bytes); current();
      if (!validId(s.hash)) throw Error('Invalid source hash');
      s.file = d.reader(id); const prepared = d.now();
      control({kind:'start',id,bytes,hash:s.hash,frameBytes});
      while (!s.complete) {
        current(); if (d.now() - started > 120000) throw Error('Direct stream timeout');
        if (s.ready && s.sent < bytes && s.sent - s.ack < WINDOW) {
          const count = Math.min(frameBytes, bytes - s.sent), value = s.file.read(count);
          if (!(value instanceof Uint8Array) || value.length !== count) throw Error('Short source read');
          s.sent += count; d.send(value);
        } else await d.wait();
      }
      const result = {id,bytes,frameBytes,elapsedMs:d.now()-started,hashMs:prepared-started,verified:true};
      results.push(result); return result;
    } catch (error) { abort(error); throw error; }
    finally { s.file?.close(); if (outgoing === s) outgoing = null; }
  }
  return {receive,send,abort,results};
}
module.exports = {createDirectStreamSession};
