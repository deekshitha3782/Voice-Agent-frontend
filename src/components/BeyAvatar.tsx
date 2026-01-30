import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Room, RoomEvent, Track, DataPacket_Kind } from "livekit-client";
import { Loader2, VideoOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Ensure the API URL has https:// protocol
const rawApiUrl = import.meta.env.VITE_API_BASE_URL || "";
const API_BASE_URL = rawApiUrl && !rawApiUrl.startsWith("http") 
  ? `https://${rawApiUrl}` 
  : rawApiUrl;

interface BeyAvatarProps {
  isActive: boolean;
  isCameraOn?: boolean;
  isMicOn?: boolean;
  isSpeakerMuted?: boolean;
  phoneNumber?: string;
  onCallStart?: (callId: string) => void;
  onCallEnd?: () => void;
  onTranscript?: (role: "user" | "assistant", content: string) => void;
  onQuotaExceeded?: () => void;
  className?: string;
}

export interface BeyAvatarHandle {
  sendContext: (context: string) => void;
  startCall: (phoneNumber?: string) => Promise<void>;
  endCall: () => Promise<void>;
}

export const BeyAvatar = forwardRef<BeyAvatarHandle, BeyAvatarProps>(({ 
  isActive, 
  isCameraOn = true,
  isMicOn = true,
  isSpeakerMuted = false,
  phoneNumber,
  onCallStart, 
  onCallEnd,
  onTranscript,
  onQuotaExceeded,
  className 
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  
  const [callId, setCallId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLocalVideo, setHasLocalVideo] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  
  const callIdRef = useRef(callId);
  const onTranscriptRef = useRef(onTranscript);
  
  useEffect(() => { callIdRef.current = callId; }, [callId]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  // Apply mic state to LiveKit local participant
  useEffect(() => {
    const updateMic = async () => {
      try {
        if (roomRef.current) {
          await roomRef.current.localParticipant.setMicrophoneEnabled(!!isMicOn);
        }
      } catch (error) {
        console.warn("Failed to update microphone state:", error);
      }
    };

    if (isConnected) {
      updateMic();
    }
  }, [isMicOn, isConnected]);

  // Apply speaker mute to avatar audio output
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = !!isSpeakerMuted;
    }
  }, [isSpeakerMuted]);
  
  // Expose sendContext function to parent via ref
  // Sends context to Beyond Presence - the AI's system prompt is configured to recognize "[System note:" messages
  const sendContext = useCallback((context: string) => {
    const sendData = () => {
      if (roomRef.current && isConnected) {
        const encoder = new TextEncoder();
        // Send as plain text - the AI's system prompt looks for "[System note:" prefix
        const data = encoder.encode(context);
        roomRef.current.localParticipant.publishData(data, { reliable: true });
        console.log("Sent context to Beyond Presence:", context);
        return true;
      }
      return false;
    };
    
    // Try to send immediately, if not connected, retry after short delay
    if (!sendData()) {
      console.log("Not connected yet, will retry sending context in 2 seconds...");
      setTimeout(() => {
        if (!sendData()) {
          console.warn("Failed to send context - still not connected");
        }
      }, 2000);
    }
  }, [isConnected]);
  
  const startCallInternal = useCallback(async (overridePhoneNumber?: string) => {
    if (isLoading || callId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/bey/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: overridePhoneNumber || phoneNumber }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        const errorMessage = data.details || data.error || "Failed to start call";
        
        // Check for quota/billing errors
        if (response.status === 402 || 
            errorMessage.includes("usage limit") || 
            errorMessage.includes("billing") ||
            errorMessage.includes("quota")) {
          console.log("Beyond Presence quota exceeded, triggering fallback");
          onQuotaExceeded?.();
          setIsLoading(false);
          return;
        }
        
        throw new Error(errorMessage);
      }

      console.log("Beyond Presence call created:", data);
      
      if (!data.livekit_url || !data.livekit_token) {
        throw new Error("Missing LiveKit connection details");
      }
      
      setCallId(data.call_id);
      onCallStart?.(data.call_id);
      
      // Connect to LiveKit room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      
      roomRef.current = room;
      
      // Set up event handlers
      room.on(RoomEvent.Connected, () => {
        console.log("Connected to LiveKit room");
        setIsConnected(true);
        setIsLoading(false);
      });
      
      room.on(RoomEvent.Disconnected, () => {
        console.log("Disconnected from LiveKit room");
        setIsConnected(false);
        setHasRemoteVideo(false);
      });
      
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log("Track subscribed:", track.kind, participant.identity);
        
        if (track.kind === Track.Kind.Video && videoRef.current) {
          track.attach(videoRef.current);
          setHasRemoteVideo(true);
        } else if (track.kind === Track.Kind.Audio && audioRef.current) {
          track.attach(audioRef.current);
        }
      });
      
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        console.log("Track unsubscribed:", track.kind);
        track.detach();
        if (track.kind === Track.Kind.Video) {
          setHasRemoteVideo(false);
        }
      });
      
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        const rawData = new TextDecoder().decode(payload);
        const isFromAgent = participant?.identity?.toLowerCase().includes("agent") || 
                           participant?.identity?.toLowerCase().includes("avatar") ||
                           participant?.identity?.toLowerCase().includes("worker");
        
        console.log("Data received from", participant?.identity, ":", rawData);
        
        try {
          const message = JSON.parse(rawData);
          
          // AI assistant responses come as JSON with {id, message, timestamp}
          if (message.message && isFromAgent) {
            if (onTranscriptRef.current) {
              onTranscriptRef.current("assistant", message.message);
            }
          }
          // Handle other transcript formats
          else if (message.transcript || message.text || message.content) {
            const role = isFromAgent ? "assistant" : "user";
            const content = message.transcript || message.text || message.content || "";
            if (content && onTranscriptRef.current) {
              onTranscriptRef.current(role, content);
            }
          }
        } catch (e) {
          // Non-JSON data - this is typically user speech transcription
          if (rawData && rawData.trim() && onTranscriptRef.current) {
            // User speech comes as plain text strings
            onTranscriptRef.current("user", rawData.trim());
          }
        }
      });
      
      // Connect to the room
      await room.connect(data.livekit_url, data.livekit_token);
      
      // Wait a moment for the connection to fully stabilize before publishing tracks
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if still connected (component might have unmounted)
      if (!roomRef.current || room.state !== 'connected') {
        console.log("Room disconnected before enabling media");
        return;
      }
      
      // Enable microphone if mic is on
      if (isMicOn) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (micError) {
          console.warn("Failed to enable microphone:", micError);
        }
      }
      
      // Enable camera if camera is on and attach to local video element
      if (isCameraOn) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          // Attach local video track
          const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (localVideoTrack?.track && localVideoRef.current) {
            localVideoTrack.track.attach(localVideoRef.current);
            setHasLocalVideo(true);
          }
        } catch (camError) {
          console.warn("Failed to enable camera:", camError);
        }
      }
      
    } catch (err) {
      console.error("Failed to start Beyond Presence call:", err);
      setError(err instanceof Error ? err.message : "Failed to start video avatar");
      setIsLoading(false);
    }
  }, [isLoading, callId, onCallStart, isMicOn, isCameraOn, phoneNumber]);

  // Wrapper for external use - allows passing phoneNumber
  const startCall = useCallback(async (overridePhoneNumber?: string) => {
    return startCallInternal(overridePhoneNumber);
  }, [startCallInternal]);

  const endCall = useCallback(async () => {
    const currentCallId = callIdRef.current;
    
    // Disconnect from LiveKit room
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    
    if (currentCallId) {
      try {
        await fetch(`${API_BASE_URL}/api/bey/call/${currentCallId}/end`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Failed to end Beyond Presence call:", err);
      }
    }
    
    setCallId(null);
    setIsConnected(false);
    setIsLoading(false);
    onCallEnd?.();
  }, [onCallEnd]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    sendContext,
    startCall,
    endCall,
  }), [sendContext, startCall, endCall]);

  // Update microphone state
  useEffect(() => {
    if (roomRef.current && isConnected) {
      roomRef.current.localParticipant.setMicrophoneEnabled(isMicOn);
    }
  }, [isMicOn, isConnected]);

  // Update camera state and attach/detach local video
  useEffect(() => {
    const room = roomRef.current;
    if (!room || !isConnected) return;
    
    const updateCamera = async () => {
      await room.localParticipant.setCameraEnabled(isCameraOn);
      
      if (isCameraOn) {
        // Wait briefly for track to be ready
        setTimeout(() => {
          const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (localVideoTrack?.track && localVideoRef.current) {
            localVideoTrack.track.attach(localVideoRef.current);
            setHasLocalVideo(true);
          }
        }, 100);
      } else {
        // Detach local video
        const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (localVideoTrack?.track && localVideoRef.current) {
          localVideoTrack.track.detach(localVideoRef.current);
        }
        setHasLocalVideo(false);
      }
    };
    
    updateCamera();
  }, [isCameraOn, isConnected]);

  // Start/end call based on isActive
  useEffect(() => {
    if (isActive && !callId && !isLoading) {
      startCall();
    } else if (!isActive && callId) {
      endCall();
    }
  }, [isActive, callId, isLoading, startCall, endCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      const cId = callIdRef.current;
      if (cId) {
        fetch(`${API_BASE_URL}/api/bey/call/${cId}/end`, { method: "POST" }).catch(() => {});
      }
    };
  }, []);

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center bg-black rounded-2xl", className)}>
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-24 h-24 rounded-full bg-destructive/20 flex items-center justify-center">
            <VideoOff className="w-12 h-12 text-destructive" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium text-white">Unable to Connect</p>
            <p className="text-sm text-gray-400 max-w-xs">{error}</p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => { setError(null); startCall(); }}
            className="mt-2"
            data-testid="button-retry-call"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || (isActive && (!isConnected || !hasRemoteVideo))) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl", className)}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <p className="text-sm text-gray-400">Please wait while we connect you to the assistant.</p>
        </div>
      </div>
    );
  }

  if (!callId) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl", className)}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-24 h-24 rounded-full bg-gray-700/50 flex items-center justify-center">
            <VideoOff className="w-12 h-12 text-gray-500" />
          </div>
          <p className="text-sm text-gray-400">Video avatar ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-black", className)}>
      {/* Video element for avatar */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        data-testid="video-avatar"
      />
      
      {/* Hidden audio element for avatar voice */}
      <audio ref={audioRef} autoPlay />
      
      {/* Connection status indicator */}
      {isConnected && (
        <div className="absolute top-4 left-4">
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-white/80 font-medium">Connected</span>
          </div>
        </div>
      )}
      
      {/* Connection status overlay */}
      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
            <p className="text-sm text-white">Please wait while we connect you to the assistant.</p>
          </div>
        </div>
      )}
    </div>
  );
});

BeyAvatar.displayName = "BeyAvatar";
