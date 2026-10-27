import {createEventDeadlineTask} from './identity/eventDeadlineTask';
export type CallQualityLevel = 'unknown' | 'poor' | 'fair' | 'good';

export interface CallQuality {
  level: CallQualityLevel;
  roundTripTimeMs: number | null;
  packetLossPercent: number | null;
  bitrateKbps: number | null;
}


/** Platform-independent sampling; getStats has no event for bitrate/loss changes.
 * Call lifecycle starts/stops this owner. Samples never overlap or publish late. */
export function createCallQualityMonitor(d:{
 current():boolean; now():number;
 stats():Promise<{forEach(fn:(report:any)=>void):void}>;
 publish(value:CallQuality):Promise<void>|void;
 failed(error:unknown):void;
 schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void;
}){
 let stopped=false;
 let previousSample:{timestamp:number;bytesSent:number}|null=null;
 const live=()=>!stopped&&d.current();
 const task=createEventDeadlineTask({now:d.now,schedule:d.schedule,cancel:d.cancel,run:async()=>{
  if(!live())return;
  try{
   const stats=await d.stats();if(!live())return;
      let bytesSent = 0;
      let roundTripTimeMs: number | null = null;
      let packetsLost = 0;
      let packetsSent = 0;

      stats.forEach((report: any) => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          bytesSent = Number(report.bytesSent) || 0;
          packetsSent = Number(report.packetsSent) || 0;
        }
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          const rtt = Number(report.currentRoundTripTime);
          if (Number.isFinite(rtt) && rtt >= 0) roundTripTimeMs = Math.round(rtt * 1000);
        }
        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          const rtt = Number(report.roundTripTime);
          if (Number.isFinite(rtt) && rtt >= 0) roundTripTimeMs = Math.round(rtt * 1000);
          packetsLost = Number(report.packetsLost) || packetsLost;
          packetsSent = Number(report.packetsSent) || packetsSent;
        }
      });

      const now = d.now();
      const previous = previousSample;
      const bitrateKbps = previous && now > previous.timestamp && bytesSent >= previous.bytesSent
        ? Math.round(((bytesSent - previous.bytesSent) * 8) / (now - previous.timestamp))
        : null;
      previousSample = { timestamp: now, bytesSent };

      const packetLossPercent = packetsSent > 0
        ? Math.round((packetsLost / (packetsSent + packetsLost)) * 1000) / 10
        : null;
      const poor = (roundTripTimeMs != null && roundTripTimeMs >= 350)
        || (packetLossPercent != null && packetLossPercent >= 8);
      const fair = (roundTripTimeMs != null && roundTripTimeMs >= 180)
        || (packetLossPercent != null && packetLossPercent >= 3);
      const level: CallQualityLevel = poor ? 'poor' : fair ? 'fair' : (roundTripTimeMs != null || packetLossPercent != null) ? 'good' : 'unknown';


   await d.publish({level,roundTripTimeMs,packetLossPercent,bitrateKbps});
  }catch(error){if(live())d.failed(error);}
  return live()?d.now()+3000:Infinity;
 }});
 return {start:task.changed,stop(){stopped=true;task.stop();previousSample=null;}};
}
