import {createCallQualityMonitor,type CallQuality} from '../services/callQualityMonitor';
import {deliverCallSignal} from '../services/callSignalRetry';
import {createCallScreenShare} from '../services/callScreenShare';
import {createCallEndHandshake} from '../services/callEndHandshake';
import {excludeScreenControls} from '../services/call-screen-capture';
import {callVideoState,readCallVideoState} from '../services/callVideoPresentation';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import {callCameraPreview} from '../services/callCameraPreview';
import {createCallPeerSelection,callPeerMode,callPeerDescription,type SelectedCallPeer,type CallPeerMode} from '../services/callPeerSelection';
/** Prefer the authenticated network peer; negotiate a call-only ICE fallback
 * when it cannot connect. Signaling stays bound to the accepted call. Cleanup
 * releases shared peers and closes only call-owned connections.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';


import { createCallRecovery } from '../services/callRecovery';
import { debugLog } from '../services/diagnostics';
import { readCallSignal } from '../services/call-signal';
import { videoQualityParameters, type VideoQualityMode } from '../services/video-quality';
import type { CallType } from '../types';
import type { CallMediaTransport } from '../services/call-media-transport';

/** The ICE gather timeout — same as web app */
const ICE_GATHER_TIMEOUT = 5000;
export type ConnectionType = 'connecting' | 'p2p' | 'relayed';

export type {CallQuality,CallQualityLevel} from '../services/callQualityMonitor';
export interface UseWebRTCOptions {
  callId: string;
  callType: CallType;
  isOutgoing: boolean;
  /** The peer identity for this call. */
  peerUserId: number | string;
  /** The authenticated neuron adapter owns signaling and ICE configuration. */
  mediaTransport?: CallMediaTransport;
  /** Called when the peer connection reaches the connected state. */
  onConnected?: () => void;
  /** Called when the peer connection disconnects/fails. */
  onDisconnected?: () => void;
}

export default function useWebRTCCore({
  callId,
  callType,
  isOutgoing,
  peerUserId,
  mediaTransport,
  onConnected,
  onDisconnected,
}: UseWebRTCOptions) {
  const recoveryRef = useRef<ReturnType<typeof createCallRecovery> | null>(null);
  const [recovering, setRecovering] = useState(false);
  const disconnectedRef = useRef(onDisconnected);
  disconnectedRef.current = onDisconnected;
  const signalVersions = useRef<Record<string,number>>({});
  const signalWaits = useRef(new Map<ReturnType<typeof setTimeout>,()=>void>());
  const sendSignal = useCallback((_userId: number | string, type: string, data: any) => {
    if (cleanedUp.current) return;
    if (!mediaTransport) { disconnectedRef.current?.(); return; }
    const version=(signalVersions.current[type]??0)+1;signalVersions.current[type]=version;
    const current=()=>!cleanedUp.current&&(type==='ice-candidate'||signalVersions.current[type]===version);
    const payload=(type==='offer'||type==='answer')&&sharedPeer.current?callPeerDescription(data,sharedPeer.current.mode):data;
    void deliverCallSignal({kind:type,current,now:Date.now,send:()=>mediaTransport.send(type,payload),
      wait:ms=>new Promise<void>(resolve=>{const timer=setTimeout(()=>{signalWaits.current.delete(timer);resolve();},ms);signalWaits.current.set(timer,resolve);}),
    }).then(sent=>{if(!sent&&type!=='ice-candidate'&&current())disconnectedRef.current?.();});
  }, [mediaTransport]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sharedPeer=useRef<SelectedCallPeer|null>(null);
  const peerSelection=useRef<ReturnType<typeof createCallPeerSelection>|null>(null);
  const peerFlight=useRef<Promise<RTCPeerConnection>|null>(null);
  const callSenders=useRef<ReturnType<RTCPeerConnection['getSenders']>>([]);
  const [videoQualityMode, setVideoQualityMode] = useState<VideoQualityMode>('automatic');
  const [videoQualityError, setVideoQualityError] = useState<string | null>(null);
  const videoQualityModeRef = useRef<VideoQualityMode>('automatic');
  const qualityLevelRef = useRef('unknown');
  const qualityQueueRef = useRef<Promise<void>>(Promise.resolve());
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaAcquirePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const pendingCandidates = useRef<RTCIceCandidate[]>([]);
  const hasRemoteDesc = useRef(false);
  const fullDescriptionSent = useRef(false);
  const cleanedUp = useRef(false);
  const selection=()=>{
    if(!mediaTransport)throw Error('Call transport unavailable');
    return peerSelection.current??=createCallPeerSelection({id:String(callId),current:()=>!cleanedUp.current,
      acquire:mediaTransport.acquirePeer,loadIceConfig:()=>mediaTransport.loadIceConfig(),
      create:cfg=>new RTCPeerConnection({iceServers:cfg.ice_servers,iceTransportPolicy:cfg.ice_transport_policy,bundlePolicy:'max-bundle'} as any)});
  };
  /** Serial queue to prevent signal race conditions (mirrors web app). */
  const signalQueue = useRef<Promise<void>>(Promise.resolve());

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const refreshSharedRemote=(pc:RTCPeerConnection)=>{
    if(!sharedPeer.current?.current()||cleanedUp.current)return;
    // Reused transceivers need not emit a second track event on the next call.
    const tracks=pc.getReceivers().flatMap(r=>r.track&&r.track.readyState!=='ended'&&(r.track.kind==='audio'||callType==='video')?[r.track]:[]);
    if(tracks.length)setRemoteStream(new MediaStream(tracks));
  };
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing,setIsScreenSharing]=useState(false),[screenShareBusy,setScreenShareBusy]=useState(false),[screenShareError,setScreenShareError]=useState<string|null>(null);
  const [remoteScreenSharing,setRemoteScreenSharing]=useState(false);
  const videoStateChannel=useRef<RTCDataChannel|null>(null),sharingRef=useRef(false);
  const endHandshake=useRef<ReturnType<typeof createCallEndHandshake>|null>(null);
  const notifyCallEnded=useCallback(()=>endHandshake.current?.end()??Promise.resolve(),[]);
  const publishVideoState=()=>{const channel=videoStateChannel.current;if(channel?.readyState==='open'&&channel.bufferedAmount<1024){try{channel.send(callVideoState(sharingRef.current));}catch{/* A presentation hint must not end the call. */}}};
  const screenShareRef=useRef<ReturnType<typeof createCallScreenShare>|null>(null);
  if(!screenShareRef.current)screenShareRef.current=createCallScreenShare({
    acquire:()=>mediaDevices.getDisplayMedia(),
    camera:()=>localStreamRef.current?.getVideoTracks()[0],
    sender:()=>pcRef.current?.getSenders().find(sender=>sender.track?.kind==='video'),
    preview:stream=>{if(!cleanedUp.current)setLocalStream(stream??localStreamRef.current);},
    changed:(sharing,busy)=>{if(!cleanedUp.current){if(sharingRef.current!==sharing){sharingRef.current=sharing;publishVideoState();if(pcRef.current)void applyVideoBitrate(pcRef.current);}setIsScreenSharing(sharing);setScreenShareBusy(busy);}},
    error:()=>{if(!cleanedUp.current)setScreenShareError('Sharing stopped, but the camera could not resume. Try a new video call.');},
  });
  const startScreenSharing=useCallback(async()=>{setScreenShareError(null);try{await screenShareRef.current?.start();}catch{if(!cleanedUp.current)setScreenShareError('Screen sharing did not start. Allow screen capture to try again.');}},[]);
  const stopScreenSharing=useCallback(async()=>{setScreenShareError(null);try{await screenShareRef.current?.stop();}catch{if(!cleanedUp.current)setScreenShareError('Sharing stopped, but the camera could not resume. Try a new video call.');}},[]);
  const setScreenControlsExcluded=useCallback(async(fraction:number)=>{
    if(!sharingRef.current)return;
    const track=pcRef.current?.getSenders().find(s=>s.track?.kind==='video')?.track;
    if(track)await excludeScreenControls(track.id,fraction);
  },[]);
  /** Whether the active path is direct P2P or relayed through TURN. */
  const [connectionType, setConnectionType] = useState<ConnectionType>('connecting');
  const [callQuality, setCallQuality] = useState<CallQuality>({
    level: 'unknown',
    roundTripTimeMs: null,
    packetLossPercent: null,
    bitrateKbps: null,
  });
  const qualityMonitor = useRef<ReturnType<typeof createCallQualityMonitor>|null>(null);



  /* ---- helpers ---- */

  /** Wait until ICE gathering is done or timeout. */
  const waitForIceGathering = useCallback((pc: RTCPeerConnection): Promise<void> => {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ICE_GATHER_TIMEOUT);
      const pcAny = pc as any;
      const origHandler = pcAny.onicegatheringstatechange;
      pcAny.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pcAny.onicegatheringstatechange = origHandler;
          resolve();
        }
      };
    });
  }, []);

  /** Acquire camera + mic. Idempotent — returns the existing stream if one
   *  has already been acquired for this call. */
  const acquireMedia = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    if (mediaAcquirePromiseRef.current) return mediaAcquirePromiseRef.current;

    mediaAcquirePromiseRef.current = (async () => {
      await callCameraPreview.stop();
      if(cleanedUp.current)throw Error('Call ended before acquiring local media');
      const constraints: any = {
        audio: true,
        video: callType === 'video'
          ? {
              facingMode: 'user',
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 360 },
              frameRate: { ideal: 30, max: 30 },
            }
          : false,
      };
      try {
        return await mediaDevices.getUserMedia(constraints) as MediaStream;
      } catch (err) {
        // Some emulators and older devices reject ideal constraints. Keep the
        // call usable with the previous low-bandwidth profile as a fallback.
        console.warn('[WebRTC] preferred camera constraints failed, using fallback:', err);
        return await mediaDevices.getUserMedia({
          audio: true,
          video: callType === 'video'
            ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 }
            : false,
        }) as MediaStream;
      }
    })();

    try {
      const stream = await mediaAcquirePromiseRef.current;
      if (cleanedUp.current) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Call ended while acquiring local media');
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      debugLog('[WebRTC] local media acquired, tracks:', stream.getTracks().length);
      return stream;
    } finally {
      mediaAcquirePromiseRef.current = null;
    }
  }, [callType]);

  const applyVideoBitrate = useCallback(async (
    pc: RTCPeerConnection,
  ) => {
    // Serialize native writes, reading the latest preference inside the queue.
    const operation = qualityQueueRef.current.then(async () => {
      if (cleanedUp.current || pcRef.current !== pc) return;
      const senders = (pc as any).getSenders?.() ?? [];
      for (const sender of senders) {
        if (sender.track?.kind !== 'video' || typeof sender.getParameters !== 'function') continue;
        try {
          const { degradationPreference, ...encoding } = videoQualityParameters(videoQualityModeRef.current, qualityLevelRef.current,sharingRef.current?(sender.track.getSettings?.()??{}):undefined);
          const parameters = sender.getParameters();
          parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
          Object.assign(parameters.encodings[0], encoding);
          parameters.degradationPreference = degradationPreference;
          await sender.setParameters(parameters);
          if (!cleanedUp.current) setVideoQualityError(null);
        } catch (err) {
          if (!cleanedUp.current) setVideoQualityError('Could not apply video quality. We’ll retry automatically.');
          console.warn('[WebRTC] unable to apply video bitrate:', err);
        }
      }
    });
    qualityQueueRef.current = operation.catch(() => {});
    await operation;
  }, []);

  const selectVideoQuality = useCallback((mode: VideoQualityMode) => {
    videoQualityModeRef.current = mode;
    setVideoQualityMode(mode);
    setVideoQualityError(null);
    if (pcRef.current) void applyVideoBitrate(pcRef.current);
  }, [applyVideoBitrate]);

  const startQualityMonitoring = useCallback((pc: RTCPeerConnection) => {
    if (callType !== 'video') return;
    qualityMonitor.current?.stop();
    const monitor=createCallQualityMonitor({current:()=>!cleanedUp.current&&pcRef.current===pc,now:Date.now,
      stats:()=>pc.getStats(),failed:err=>console.warn('[WebRTC] quality stats failed:',err),
      publish:async value=>{setCallQuality(value);qualityLevelRef.current=value.level;await applyVideoBitrate(pc);}});
    qualityMonitor.current=monitor;monitor.start();
  }, [callType, applyVideoBitrate]);

  /** Flush buffered ICE candidates after remote description is set. */
  const flushCandidates = useCallback(() => {
    const pc = pcRef.current;
    if (!pc || !hasRemoteDesc.current) return;
    while (pendingCandidates.current.length > 0) {
      const c = pendingCandidates.current.shift()!;
      pc.addIceCandidate(c).catch(() => {});
    }
  }, []);

  /**
   * Examine the active candidate pair via getStats() and set connectionType.
   * 'relayed' means at least one side is using a TURN relay.
   * 'p2p' means both sides are direct (host / srflx / prflx candidates).
   */
  const detectConnectionType = useCallback(async (pc: RTCPeerConnection) => {
    try {
      const stats: RTCStatsReport = await (pc as any).getStats();
      const candidates: Record<string, any> = {};

      stats.forEach((report: any) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidates[report.id] = report;
        }
      });

      let detected = false;
      stats.forEach((report: any) => {
        if (
          !detected &&
          report.type === 'candidate-pair' &&
          (report.state === 'succeeded' || report.nominated)
        ) {
          const local = candidates[report.localCandidateId];
          const remote = candidates[report.remoteCandidateId];
          const isRelayed =
            local?.candidateType === 'relay' || remote?.candidateType === 'relay';
          setConnectionType(isRelayed ? 'relayed' : 'p2p');
          debugLog(
            `[WebRTC] connection path: ${isRelayed ? 'relayed via TURN' : 'direct P2P'}`,
            `(local: ${local?.candidateType ?? '?'}, remote: ${remote?.candidateType ?? '?'})`
          );
          detected = true;
        }
      });

      if (!detected) {
        // Stats not yet ready — default to p2p if we're connected
        setConnectionType('p2p');
      }
    } catch (err) {
      console.warn('[WebRTC] getStats failed, cannot determine connection type:', err);
    }
  }, []);

  /** Borrow the authenticated network connection and attach this call's media. */
  const createPeerConnection = useCallback(
    async (stream: MediaStream, mode:CallPeerMode|'prefer-shared'='prefer-shared'): Promise<RTCPeerConnection> => {
      if(pcRef.current){if(mode!=='prefer-shared'&&sharedPeer.current?.mode!==mode)throw Error('Call peer mode changed');return pcRef.current;}
      if(peerFlight.current)return peerFlight.current;
      const build=async()=>{
      const lease=await selection().select(mode);
      if(cleanedUp.current){lease.release();throw Error('Call ended');}
      sharedPeer.current=lease;
      const pc = lease.connection as RTCPeerConnection;
      pcRef.current = pc;
      if(callType==='video'){
        const label=lease.channelLabel;
        const attach=(channel:RTCDataChannel)=>{
          if(channel.label!==label)return;
          if(videoStateChannel.current){channel.close();return;}
          videoStateChannel.current=channel;
          endHandshake.current?.close();
          const ending=createCallEndHandshake(String(callId),{
            send:raw=>{if(cleanedUp.current||pcRef.current!==pc||channel.readyState!=='open'||channel.bufferedAmount>4096)return false;try{channel.send(raw);return true;}catch{return false;}},
            ended:()=>{if(!cleanedUp.current&&pcRef.current===pc)disconnectedRef.current?.();},
          });endHandshake.current=ending;
          (channel as any).onopen=publishVideoState;
          (channel as any).onmessage=(event:{data:unknown})=>{if(cleanedUp.current||pcRef.current!==pc||ending.receive(event.data))return;const sharing=readCallVideoState(event.data);if(sharing!==null)setRemoteScreenSharing(sharing);};
          (channel as any).onclose=()=>{ending.close();if(videoStateChannel.current===channel){videoStateChannel.current=null;if(!cleanedUp.current)setRemoteScreenSharing(false);}};
          publishVideoState();
        };
        (pc as any).ondatachannel=(event:{channel:RTCDataChannel})=>attach(event.channel);
        if(isOutgoing)attach(pc.createDataChannel(label,{ordered:true}));
      }
      hasRemoteDesc.current = false;
      fullDescriptionSent.current = false;
      startQualityMonitoring(pc);

      // Add local tracks
      for(const track of stream.getTracks()){
        if(cleanedUp.current)throw Error('Call ended');
        const reusable=pc.getTransceivers().find(t=>!t.stopped&&!t.sender.track&&t.receiver.track?.kind===track.kind);
        if(reusable){await reusable.sender.replaceTrack(track);if(cleanedUp.current){await reusable.sender.replaceTrack(null);throw Error('Call ended');}reusable.direction='sendrecv';callSenders.current.push(reusable.sender);}
        else callSenders.current.push(pc.addTrack(track, stream));
      }

      // Remote stream
      (pc as any).ontrack = (event: any) => {
        debugLog('[WebRTC] remote track received');
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      // Trickle ICE candidates (backup — primary is full SDP)
      (pc as any).onicecandidate = (event: any) => {
        // Neuron descriptions already include gathered candidates. Avoid putting each signed
        // candidate ahead of the offer in the durable-admission queue; retain late trickle ICE.
        if (!fullDescriptionSent.current) return;
        if (event.candidate) {
          sendSignal(peerUserId, 'ice-candidate', event.candidate.toJSON());
        }
      };

      recoveryRef.current?.stop();
      const recovery = createCallRecovery({
        outgoing: isOutgoing,
        recovering: setRecovering,
        ended: () => { if (!cleanedUp.current && pcRef.current === pc) disconnectedRef.current?.(); },
        restart: () => {
          const operation = signalQueue.current.then(async () => {
            if (cleanedUp.current || pcRef.current !== pc || !recovery.active()) return;
            // Avoid overlapping an outstanding initial offer or remote negotiation.
            if (pc.signalingState !== 'stable') return;
            fullDescriptionSent.current = false;
            const offer = await pc.createOffer({iceRestart: true} as any);
            if (cleanedUp.current || pcRef.current !== pc) return;
            await pc.setLocalDescription(offer);
            await waitForIceGathering(pc);
            if (!cleanedUp.current && pcRef.current === pc && pc.localDescription) {
              sendSignal(peerUserId, 'offer', pc.localDescription.toJSON());
              fullDescriptionSent.current = true;
            }
          });
          signalQueue.current = operation.catch(() => {});
          return operation;
        },
      });
      recoveryRef.current = recovery;
      (pc as any).oniceconnectionstatechange = () => {
        if (cleanedUp.current || pcRef.current !== pc) return;
        const state = pc.iceConnectionState;
        recovery.state(state);
        if (state === 'connected' || state === 'completed') {
          onConnected?.();
          void detectConnectionType(pc);
        } else if (state === 'disconnected' || state === 'failed') {
          setConnectionType('connecting');
        }
      };

      return pc;
      };
      peerFlight.current=build();
      try{return await peerFlight.current;}finally{peerFlight.current=null;}
    },
    [peerUserId, sendSignal, mediaTransport, isOutgoing, onConnected, onDisconnected, waitForIceGathering, detectConnectionType, startQualityMonitoring],
  );

  /* ---- Caller flow: called after call_accepted ---- */
  const startAsOfferer = useCallback(async () => {
    if (cleanedUp.current) return;
    debugLog('[WebRTC] startAsOfferer');
    try {
      const stream = await acquireMedia();
      if (cleanedUp.current) return;
      const pc = await createPeerConnection(stream);

      const offer = await pc.createOffer({} as any);
      if(cleanedUp.current)return;
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering (up to 5s), then send full offer
      await waitForIceGathering(pc);

      if (pc.localDescription && !cleanedUp.current) {
        debugLog('[WebRTC] sending offer');
        sendSignal(peerUserId, 'offer', pc.localDescription.toJSON());
        fullDescriptionSent.current = true;
      }
    } catch (err) {
      console.error('[WebRTC] startAsOfferer error:', err);
      if(!cleanedUp.current)disconnectedRef.current?.();
    }
  }, [acquireMedia, createPeerConnection, waitForIceGathering, sendSignal, peerUserId]);

  /* ---- Callee flow: called on mount (media acquired, waits for offer) ---- */
  const startAsAnswerer = useCallback(async () => {
    if (cleanedUp.current) return;
    debugLog('[WebRTC] startAsAnswerer — acquiring media, waiting for offer');
    try {
      await acquireMedia();
      // Start shared discovery, but let the authenticated offer choose the mode.
      if(!cleanedUp.current&&mediaTransport)void selection().warm();
    } catch (err) {
      console.error('[WebRTC] startAsAnswerer error:', err);
      if(!cleanedUp.current)disconnectedRef.current?.();
    }
  }, [acquireMedia,createPeerConnection,mediaTransport]);

  /* ---- Handle incoming WebRTC signals ---- */
  useEffect(() => {
    let subscribed = true;
    let queuedSignals = 0;
    const handle = (signal_type: string | undefined, from_user_id: number | string | undefined, rawData: unknown) => {
      if (!subscribed) return;
      if (cleanedUp.current) return;
      const data = readCallSignal(rawData, callId);
      if (!data) return;
      // Only handle signals from our peer
      if (from_user_id !== peerUserId) return;
      if (!['offer', 'answer', 'ice-candidate'].includes(signal_type ?? '')) return;
      if (queuedSignals >= 64) { disconnectedRef.current?.(); return; }
      queuedSignals++;

      // Enqueue to serial signal queue (prevents race conditions)
      signalQueue.current = signalQueue.current.then(async () => {
        if (!subscribed || cleanedUp.current) return;

        if (signal_type === 'offer') {
          if (data.type !== 'offer' || typeof data.sdp !== 'string') return;
          debugLog('[WebRTC] received offer from', from_user_id);
          try {
            // The offer can beat microphone/camera acquisition on a fast
            // local connection. Await the same single-flight media promise
            // instead of dropping the offer and leaving a fake call timer
            // with no peer connection.
            const stream = localStreamRef.current ?? await acquireMedia();
                  if (cleanedUp.current) return;
            // Create PC if not yet created
            const pc = await createPeerConnection(stream,callPeerMode(data.sdp));
            if(sharedPeer.current&&!sharedPeer.current.validateRemote(data.sdp))throw Error('Shared peer certificate changed');

            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
            hasRemoteDesc.current = true;
            flushCandidates();

            const answer = await pc.createAnswer();
            if(cleanedUp.current)return;
            await pc.setLocalDescription(answer);
            if(sharedPeer.current?.mode==='shared'){refreshSharedRemote(pc);onConnected?.();void detectConnectionType(pc);}

            await waitForIceGathering(pc);

            if (pc.localDescription && !cleanedUp.current) {
              debugLog('[WebRTC] sending answer');
              sendSignal(from_user_id!, 'answer', pc.localDescription.toJSON());
              fullDescriptionSent.current = true;
            }
          } catch (err) {
            console.error('[WebRTC] handle offer error:', err);
          }

        } else if (signal_type === 'answer') {
          if (data.type !== 'answer' || typeof data.sdp !== 'string') return;
          debugLog('[WebRTC] received answer');
          try {
            const pc = pcRef.current;
            if (!pc) return;
            if(sharedPeer.current&&callPeerMode(data.sdp)!==sharedPeer.current.mode)throw Error('Call peer mode changed');
            if(sharedPeer.current&&!sharedPeer.current.validateRemote(data.sdp))throw Error('Shared peer certificate changed');
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
            if(sharedPeer.current?.mode==='shared'){refreshSharedRemote(pc);onConnected?.();void detectConnectionType(pc);}
            hasRemoteDesc.current = true;
            flushCandidates();
          } catch (err) {
            console.error('[WebRTC] handle answer error:', err);
          }

        } else if (signal_type === 'ice-candidate') {
          try {
            const candidate = new RTCIceCandidate(data);
            if (hasRemoteDesc.current && pcRef.current) {
              await pcRef.current.addIceCandidate(candidate);
            } else {
              pendingCandidates.current.push(candidate);
            }
          } catch (err) {
            console.error('[WebRTC] add ICE error:', err);
          }
        }
      }).catch(() => { if (subscribed && !cleanedUp.current) disconnectedRef.current?.(); })
        .finally(() => { queuedSignals--; });
    };
    const unsub = mediaTransport?.subscribe((kind, data) => handle(kind, peerUserId, data)) ?? (() => {});
    return () => { subscribed = false; unsub(); };
  }, [mediaTransport, peerUserId, callId, acquireMedia, createPeerConnection, flushCandidates, sendSignal, waitForIceGathering]);

  /* ---- Kick off the right flow on mount ---- */
  useEffect(() => {
    if (isOutgoing) {
      // Caller: pre-warm the camera so the user sees their selfie preview
      // immediately while ringing. The actual peer connection / offer is
      // created later when call_accepted fires (startAsOfferer reuses this
      // already-acquired stream).
      if (callType === 'video') {
        acquireMedia().catch((err) =>
          console.warn('[WebRTC] caller preview acquireMedia failed:', err),
        );
      }
    } else {
      // Callee: acquire media immediately, wait for offer
      startAsAnswerer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Toggle mute ---- */
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, []);

  /* ---- Toggle camera ---- */
  const toggleCamera = useCallback(() => {
    if(screenShareRef.current?.active())return;
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  }, []);

  /* ---- Switch camera (front/back) ---- */
  const switchCamera = useCallback(() => {
    if(screenShareRef.current?.active())return;
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0] as any;
    if (videoTrack && typeof videoTrack._switchCamera === 'function') {
      videoTrack._switchCamera();
    }
  }, []);

  /* ---- Cleanup ---- */
  const cleanup = useCallback(() => {
    debugLog('[WebRTC] cleanup');
    cleanedUp.current = true;
    peerSelection.current?.stop();
    screenShareRef.current?.close();
    endHandshake.current?.close();endHandshake.current=null;
    videoStateChannel.current?.close();videoStateChannel.current=null;
    recoveryRef.current?.stop();
    recoveryRef.current = null;
    for(const [timer,resolve] of signalWaits.current){clearTimeout(timer);resolve();}
    signalWaits.current.clear();

    qualityMonitor.current?.stop();qualityMonitor.current=null;

    if (pcRef.current) {
      if(sharedPeer.current){
        // Stop this call's senders, never the network connection or data channels.
        const detached=callSenders.current.map(sender=>sender.replaceTrack(null).catch(()=>{}));
        const pc=pcRef.current;
        (pc as any).ontrack=null;(pc as any).onicecandidate=null;
        (pc as any).oniceconnectionstatechange=null;(pc as any).ondatachannel=null;
        const lease=sharedPeer.current;sharedPeer.current=null;
        void Promise.allSettled([...detached,signalQueue.current]).then(async()=>{
          if(!lease.current())return;
          if(pc.signalingState==='have-local-offer')await pc.setLocalDescription({type:'rollback'} as any);
          else if(pc.signalingState==='have-remote-offer')await pc.setRemoteDescription({type:'rollback'} as any);
        }).catch(()=>{/* Network owner retains the transport; no call may close it. */}).finally(()=>lease.release());
      }
      callSenders.current=[];
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setConnectionType('connecting');
    hasRemoteDesc.current = false;
    pendingCandidates.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  return {
    isScreenSharing,remoteScreenSharing,screenShareBusy,screenShareError,startScreenSharing,stopScreenSharing,setScreenControlsExcluded,notifyCallEnded,
    recovering,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    /** 'connecting' while negotiating, 'p2p' if direct, 'relayed' if via TURN */
    connectionType,
    toggleMute,
    toggleCamera,
    switchCamera,
    callQuality,
    videoQualityMode,
    videoQualityError,
    selectVideoQuality,
    /** Caller calls this after receiving call_accepted */
    startAsOfferer,
    cleanup,
  };
}


