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

/** Fallback config if the server is unreachable */
const FALLBACK_ICE_CONFIG: IceConfig = {
  ice_servers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  ice_transport_policy: 'all',
};

export type ConnectionType = 'connecting' | 'p2p' | 'relayed';

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

  /** Acquire camera + mic. */
  const acquireMedia = useCallback(async (): Promise<MediaStream> => {
    const constraints: any = {
      audio: true,
      video: callType === 'video'
        ? { facingMode: 'user', width: 640, height: 480 }
        : false,
    };
    const stream = await mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream as MediaStream;
    setLocalStream(stream as MediaStream);
    console.log('[WebRTC] local media acquired, tracks:', (stream as MediaStream).getTracks().length);
    return stream as MediaStream;
  }, [callType]);

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
    [peerUserId, sendSignal, isOutgoing, onConnected, onDisconnected, waitForIceGathering, detectConnectionType],
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
            const stream = localStreamRef.current;
            if (!stream) {
              console.warn('[WebRTC] no local stream when offer arrived');
              return;
            }
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
  }, [subscribe, peerUserId, createPeerConnection, flushCandidates, sendSignal, waitForIceGathering]);

  /* ---- Kick off the right flow on mount ---- */
  useEffect(() => {
    if (isOutgoing) {
      // Caller: wait for call_accepted → then startAsOfferer (handled in ActiveCallScreen)
    } else {
      // Callee: acquire media immediately, wait for offer
      startAsAnswerer();
    }
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
    /** Caller calls this after receiving call_accepted */
    startAsOfferer,
    cleanup,
  };
}


