/* ------------------------------------------------------------------ */
/*  useWebRTC — peer-to-peer audio/video using react-native-webrtc    */
/*  Mirrors the web app's signaling flow exactly:                      */
/*    Caller  → receives call_accepted → creates offer → sends        */
/*    Callee  → receives offer → creates answer → sends               */
/*    Both    → trickle ICE candidates + full SDP with gathered ICE    */
/*                                                                      */
/*  ICE/TURN strategy                                                   */
/*    On mount the hook fetches /api/calls/ice-config/ which returns   */
/*    STUN + TURN servers configured for the user's connectivity mode: */
/*      auto   → try P2P first, fall back to TURN relay               */
/*      p2p    → STUN only, never use relay                            */
/*      server → TURN relay only (iceTransportPolicy = 'relay')        */
/*    connectionType exposes the actual path chosen: 'p2p' | 'relayed' */
/* ------------------------------------------------------------------ */

import { useRef, useCallback, useEffect, useState } from 'react';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getIceConfig } from '../services/callService';
import type { CallType, IceConfig } from '../types';

/** The ICE gather timeout — same as web app */
const ICE_GATHER_TIMEOUT = 5000;

let prewarmedVideoStream: MediaStream | null = null;

export async function prewarmVideoCallMedia(): Promise<MediaStream> {
  if (prewarmedVideoStream) return prewarmedVideoStream;
  try {
    prewarmedVideoStream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 360 },
        frameRate: { ideal: 30, max: 30 },
      },
    }) as MediaStream;
  } catch {
    prewarmedVideoStream = await mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user', width: 640, height: 480, frameRate: 24 },
    }) as MediaStream;
  }
  return prewarmedVideoStream;
}

export function takePrewarmedVideoCallMedia(): MediaStream | null {
  const stream = prewarmedVideoStream;
  prewarmedVideoStream = null;
  return stream;
}

export function discardPrewarmedVideoCallMedia(): void {
  if (!prewarmedVideoStream) return;
  prewarmedVideoStream.getTracks().forEach((track) => track.stop());
  prewarmedVideoStream = null;
}

/** Fallback config if the server is unreachable */
const FALLBACK_ICE_CONFIG: IceConfig = {
  ice_servers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  ice_transport_policy: 'all',
};

export type ConnectionType = 'connecting' | 'p2p' | 'relayed';

export type CallQualityLevel = 'unknown' | 'poor' | 'fair' | 'good';

export interface CallQuality {
  level: CallQualityLevel;
  roundTripTimeMs: number | null;
  packetLossPercent: number | null;
  bitrateKbps: number | null;
}

interface UseWebRTCOptions {
  callId: string;
  callType: CallType;
  isOutgoing: boolean;
  /** The other user's numeric ID (needed for sendSignal). */
  peerUserId: number;
  /** Called when the peer connection reaches the connected state. */
  onConnected?: () => void;
  /** Called when the peer connection disconnects/fails. */
  onDisconnected?: () => void;
}

export default function useWebRTC({
  callId,
  callType,
  isOutgoing,
  peerUserId,
  onConnected,
  onDisconnected,
}: UseWebRTCOptions) {
  const { sendSignal, subscribe } = useNotificationContext();

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaAcquirePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const pendingCandidates = useRef<RTCIceCandidate[]>([]);
  const hasRemoteDesc = useRef(false);
  const cleanedUp = useRef(false);
  const iceConfigRef = useRef<IceConfig>(FALLBACK_ICE_CONFIG);
  /** Serial queue to prevent signal race conditions (mirrors web app). */
  const signalQueue = useRef<Promise<void>>(Promise.resolve());

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  /** Whether the active path is direct P2P or relayed through TURN. */
  const [connectionType, setConnectionType] = useState<ConnectionType>('connecting');
  const [callQuality, setCallQuality] = useState<CallQuality>({
    level: 'unknown',
    roundTripTimeMs: null,
    packetLossPercent: null,
    bitrateKbps: null,
  });
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qualitySampleRef = useRef<{ timestamp: number; bytesSent: number } | null>(null);

  /* ---- Fetch ICE config from server on mount ---- */
  useEffect(() => {
    getIceConfig().then((cfg) => {
      iceConfigRef.current = cfg;
      console.log(
        `[WebRTC] ICE config loaded — policy: ${cfg.ice_transport_policy}, servers: ${cfg.ice_servers.length}`
      );
    });
  }, []);

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
   *  has already been acquired (e.g. caller pre-warmed the preview while
   *  ringing). */
  const acquireMedia = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    if (mediaAcquirePromiseRef.current) return mediaAcquirePromiseRef.current;

    mediaAcquirePromiseRef.current = (async () => {
      const prewarmed = callType === 'video' ? takePrewarmedVideoCallMedia() : null;
      if (prewarmed) return prewarmed;
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
      console.log('[WebRTC] local media acquired, tracks:', stream.getTracks().length);
      return stream;
    } finally {
      mediaAcquirePromiseRef.current = null;
    }
  }, [callType]);

  const applyVideoBitrate = useCallback(async (
    pc: RTCPeerConnection,
    maxBitrate: number,
    degradationPreference: 'maintain-resolution' | 'balanced',
  ) => {
    const senders = (pc as any).getSenders?.() ?? [];
    for (const sender of senders) {
      if (sender.track?.kind !== 'video' || typeof sender.getParameters !== 'function') continue;
      try {
        const parameters = sender.getParameters();
        parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        parameters.encodings[0].maxBitrate = maxBitrate;
        parameters.encodings[0].maxFramerate = 30;
        parameters.encodings[0].scaleResolutionDownBy = 1;
        // Prefer keeping the full capture resolution on a good connection —
        // WebRTC's default 'balanced' preference drops resolution first,
        // which is the softness users notice even when bandwidth is fine.
        parameters.degradationPreference = degradationPreference;
        if (typeof sender.setParameters === 'function') await sender.setParameters(parameters);
      } catch (err) {
        console.warn('[WebRTC] unable to apply video bitrate:', err);
      }
    }
  }, []);

  const measureCallQuality = useCallback(async (pc: RTCPeerConnection) => {
    try {
      const stats: RTCStatsReport = await (pc as any).getStats();
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

      const now = Date.now();
      const previous = qualitySampleRef.current;
      const bitrateKbps = previous && now > previous.timestamp && bytesSent >= previous.bytesSent
        ? Math.round(((bytesSent - previous.bytesSent) * 8) / (now - previous.timestamp))
        : null;
      qualitySampleRef.current = { timestamp: now, bytesSent };

      const packetLossPercent = packetsSent > 0
        ? Math.round((packetsLost / (packetsSent + packetsLost)) * 1000) / 10
        : null;
      const poor = (roundTripTimeMs != null && roundTripTimeMs >= 350)
        || (packetLossPercent != null && packetLossPercent >= 8);
      const fair = (roundTripTimeMs != null && roundTripTimeMs >= 180)
        || (packetLossPercent != null && packetLossPercent >= 3);
      const level: CallQualityLevel = poor ? 'poor' : fair ? 'fair' : (roundTripTimeMs != null || packetLossPercent != null) ? 'good' : 'unknown';

      setCallQuality({ level, roundTripTimeMs, packetLossPercent, bitrateKbps });
      // Raised ceilings so a good connection actually renders at near-source
      // quality instead of settling for a conservative default cap.
      if (poor) {
        await applyVideoBitrate(pc, 500_000, 'balanced');
      } else if (fair) {
        await applyVideoBitrate(pc, 1_200_000, 'balanced');
      } else {
        await applyVideoBitrate(pc, 2_500_000, 'maintain-resolution');
      }
    } catch (err) {
      console.warn('[WebRTC] quality stats failed:', err);
    }
  }, [applyVideoBitrate]);

  const startQualityMonitoring = useCallback((pc: RTCPeerConnection) => {
    if (callType !== 'video') return;
    if (qualityTimerRef.current) clearInterval(qualityTimerRef.current);
    qualitySampleRef.current = null;
    measureCallQuality(pc).catch(() => {});
    qualityTimerRef.current = setInterval(() => {
      if (!cleanedUp.current) measureCallQuality(pc).catch(() => {});
    }, 3000);
  }, [callType, measureCallQuality]);

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
          console.log(
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

  /** Create RTCPeerConnection with the fetched ICE config, add local tracks, wire up handlers. */
  const createPeerConnection = useCallback(
    (stream: MediaStream): RTCPeerConnection => {
      const { ice_servers, ice_transport_policy } = iceConfigRef.current;

      const pc = new RTCPeerConnection({
        iceServers: ice_servers,
        iceTransportPolicy: ice_transport_policy,
      } as any);
      pcRef.current = pc;
      hasRemoteDesc.current = false;
      startQualityMonitoring(pc);

      // Add local tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Remote stream
      (pc as any).ontrack = (event: any) => {
        console.log('[WebRTC] remote track received');
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      // Trickle ICE candidates (backup — primary is full SDP)
      (pc as any).onicecandidate = (event: any) => {
        if (event.candidate) {
          sendSignal(peerUserId, 'ice-candidate', event.candidate.toJSON());
        }
      };

      // Connection state
      (pc as any).oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log('[WebRTC] ICE state:', state);

        if (state === 'connected' || state === 'completed') {
          onConnected?.();
          // Detect whether we ended up P2P or relayed
          detectConnectionType(pc);
        } else if (state === 'disconnected' || state === 'failed') {
          if (state === 'failed' && isOutgoing) {
            console.log('[WebRTC] ICE failed, attempting restart');
            pc.createOffer({ iceRestart: true } as any)
              .then((offer: any) => pc.setLocalDescription(offer))
              .then(() => waitForIceGathering(pc))
              .then(() => {
                if (pc.localDescription) {
                  sendSignal(peerUserId, 'offer', pc.localDescription.toJSON());
                }
              })
              .catch(() => {});
          } else if (state === 'disconnected') {
            setConnectionType('connecting');
            onDisconnected?.();
          }
        }
      };

      return pc;
    },
    [peerUserId, sendSignal, isOutgoing, onConnected, onDisconnected, waitForIceGathering, detectConnectionType, startQualityMonitoring],
  );

  /* ---- Caller flow: called after call_accepted ---- */
  const startAsOfferer = useCallback(async () => {
    if (cleanedUp.current) return;
    console.log('[WebRTC] startAsOfferer');
    try {
      const stream = await acquireMedia();
      const pc = createPeerConnection(stream);

      const offer = await pc.createOffer({} as any);
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering (up to 5s), then send full offer
      await waitForIceGathering(pc);

      if (pc.localDescription && !cleanedUp.current) {
        console.log('[WebRTC] sending offer');
        sendSignal(peerUserId, 'offer', pc.localDescription.toJSON());
      }
    } catch (err) {
      console.error('[WebRTC] startAsOfferer error:', err);
    }
  }, [acquireMedia, createPeerConnection, waitForIceGathering, sendSignal, peerUserId]);

  /* ---- Callee flow: called on mount (media acquired, waits for offer) ---- */
  const startAsAnswerer = useCallback(async () => {
    if (cleanedUp.current) return;
    console.log('[WebRTC] startAsAnswerer — acquiring media, waiting for offer');
    try {
      await acquireMedia();
      // PeerConnection is created when the offer arrives (in signal handler)
    } catch (err) {
      console.error('[WebRTC] startAsAnswerer error:', err);
    }
  }, [acquireMedia]);

  /* ---- Handle incoming WebRTC signals ---- */
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (payload.event !== 'webrtc_signal') return;
      if (cleanedUp.current) return;

      const { signal_type, data, from_user_id } = payload;
      // Only handle signals from our peer
      if (from_user_id !== peerUserId) return;

      // Enqueue to serial signal queue (prevents race conditions)
      signalQueue.current = signalQueue.current.then(async () => {
        if (cleanedUp.current) return;

        if (signal_type === 'offer') {
          console.log('[WebRTC] received offer from', from_user_id);
          try {
            // The offer can beat microphone/camera acquisition on a fast
            // local connection. Await the same single-flight media promise
            // instead of dropping the offer and leaving a fake call timer
            // with no peer connection.
            const stream = localStreamRef.current ?? await acquireMedia();
            if (cleanedUp.current) return;
            // Create PC if not yet created
            const pc = pcRef.current ?? createPeerConnection(stream);

            await pc.setRemoteDescription(new RTCSessionDescription(data));
            hasRemoteDesc.current = true;
            flushCandidates();

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await waitForIceGathering(pc);

            if (pc.localDescription && !cleanedUp.current) {
              console.log('[WebRTC] sending answer');
              sendSignal(from_user_id!, 'answer', pc.localDescription.toJSON());
            }
          } catch (err) {
            console.error('[WebRTC] handle offer error:', err);
          }

        } else if (signal_type === 'answer') {
          console.log('[WebRTC] received answer');
          try {
            const pc = pcRef.current;
            if (!pc) return;
            await pc.setRemoteDescription(new RTCSessionDescription(data));
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
      });
    });

    return unsub;
  }, [subscribe, peerUserId, acquireMedia, createPeerConnection, flushCandidates, sendSignal, waitForIceGathering]);

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
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0] as any;
    if (videoTrack && typeof videoTrack._switchCamera === 'function') {
      videoTrack._switchCamera();
    }
  }, []);

  /* ---- Cleanup ---- */
  const cleanup = useCallback(() => {
    console.log('[WebRTC] cleanup');
    cleanedUp.current = true;

    if (qualityTimerRef.current) {
      clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
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
    /** Caller calls this after receiving call_accepted */
    startAsOfferer,
    cleanup,
  };
}


