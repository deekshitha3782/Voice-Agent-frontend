import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, Volume2, VolumeX } from "lucide-react";

interface AnimatedAvatarProps {
  isActive: boolean;
  isMicOn: boolean;
  sessionId: number;
  onMicToggle: () => void;
  onEndCall: () => void;
  onTranscript: (text: string, isAi: boolean) => void;
  onCallStart?: () => void;
  onCallEnd?: () => void;
}

type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export function AnimatedAvatar({
  isActive,
  isMicOn,
  sessionId,
  onMicToggle,
  onEndCall,
  onTranscript,
  onCallStart,
  onCallEnd,
}: AnimatedAvatarProps) {
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [eyeBlink, setEyeBlink] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Blink animation
  useEffect(() => {
    if (!isActive) return;
    
    const blinkInterval = setInterval(() => {
      setEyeBlink(true);
      setTimeout(() => setEyeBlink(false), 150);
    }, 3000 + Math.random() * 2000);

    return () => clearInterval(blinkInterval);
  }, [isActive]);

  // Mouth animation when speaking
  useEffect(() => {
    if (avatarState !== "speaking") {
      setMouthOpen(0);
      return;
    }

    const mouthInterval = setInterval(() => {
      setMouthOpen(Math.random() * 0.8 + 0.2);
    }, 100);

    return () => clearInterval(mouthInterval);
  }, [avatarState]);

  // Initialize call
  useEffect(() => {
    if (isActive && !isConnected) {
      initializeCall();
    } else if (!isActive && isConnected) {
      cleanupCall();
    }
  }, [isActive]);

  const initializeCall = async () => {
    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup audio context for voice activity detection
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      setIsConnected(true);
      onCallStart?.();

      // Send initial greeting
      setTimeout(() => {
        sendGreeting();
      }, 500);
    } catch (error) {
      console.error("Failed to initialize call:", error);
    }
  };

  const cleanupCall = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setIsConnected(false);
    setAvatarState("idle");
    onCallEnd?.();
  };

  const sendGreeting = async () => {
    setAvatarState("speaking");
    const greeting = "Hello! Welcome to our appointment scheduling service. I can help you book, view, or manage your appointments. To get started, could you please tell me your name and phone number?";
    onTranscript(greeting, true);
    
    await speakText(greeting);
    
    setAvatarState("listening");
    startListening();
  };

  const startListening = () => {
    if (!streamRef.current || !isMicOn) return;

    audioChunksRef.current = [];
    
    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4"
    });
    
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await processUserSpeech(audioBlob);
      }
    };

    mediaRecorder.start(100);
    monitorSilence();
  };

  const monitorSilence = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    let silenceStart: number | null = null;
    let hasHeardSpeech = false;
    const recordingStartTime = Date.now();
    const SILENCE_THRESHOLD = 15;
    const SPEECH_THRESHOLD = 20;
    const SILENCE_DURATION = 1800;
    const MIN_RECORDING_TIME = 500;

    const checkAudio = () => {
      if (!analyserRef.current || avatarState !== "listening") return;

      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

      // Track if we've heard any speech
      if (average > SPEECH_THRESHOLD) {
        hasHeardSpeech = true;
        silenceStart = null;
      } else if (average < SILENCE_THRESHOLD) {
        // Only start silence timer if we've heard speech and recorded long enough
        if (hasHeardSpeech && Date.now() - recordingStartTime > MIN_RECORDING_TIME) {
          if (!silenceStart) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart > SILENCE_DURATION) {
            // User stopped speaking
            if (mediaRecorderRef.current?.state === "recording") {
              console.log("Silence detected, stopping recording");
              mediaRecorderRef.current.stop();
            }
            return;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkAudio);
    };

    checkAudio();
  };

  const processUserSpeech = async (audioBlob: Blob) => {
    console.log("Processing speech, blob size:", audioBlob.size);
    
    if (audioBlob.size < 2000) {
      console.log("Audio too short, restarting listening");
      // Too short, restart listening
      startListening();
      return;
    }

    setAvatarState("thinking");

    try {
      // Transcribe audio
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const transcribeRes = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!transcribeRes.ok) throw new Error("Transcription failed");

      const { text: userText } = await transcribeRes.json();
      console.log("Transcribed text:", userText);
      
      if (!userText || userText.trim().length < 2) {
        console.log("No text transcribed, restarting listening");
        startListening();
        return;
      }

      onTranscript(userText, false);

      // Get AI response
      console.log("Getting AI response...");
      const chatRes = await fetch("/api/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, sessionId }),
      });

      if (!chatRes.ok) throw new Error("Chat failed");

      const { response: aiResponse } = await chatRes.json();
      console.log("AI response:", aiResponse?.substring(0, 100) + "...");
      onTranscript(aiResponse, true);

      // Speak response
      setAvatarState("speaking");
      await speakText(aiResponse);

      // Continue listening
      setAvatarState("listening");
      startListening();
    } catch (error) {
      console.error("Error processing speech:", error);
      setAvatarState("listening");
      startListening();
    }
  };

  const speakText = async (text: string): Promise<void> => {
    if (!isSpeakerOn) return;

    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error("TTS failed");

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      return new Promise((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.play().catch(() => resolve());
      });
    } catch (error) {
      console.error("TTS error:", error);
    }
  };

  const handleEndCall = () => {
    cleanupCall();
    onEndCall();
  };

  // Avatar SVG with animations
  const renderAvatar = () => {
    const eyeY = eyeBlink ? 142 : 140;
    const eyeHeight = eyeBlink ? 2 : 12;
    const mouthHeight = 8 + mouthOpen * 20;
    const mouthY = 175 - mouthOpen * 5;

    // Breathing animation for body
    const breatheScale = 1 + Math.sin(Date.now() / 1000) * 0.01;

    // State-based colors
    const faceColor = avatarState === "speaking" ? "#FFE4C4" : 
                      avatarState === "listening" ? "#FFE0B2" : 
                      avatarState === "thinking" ? "#FFDAB9" : "#FFE4C4";
    
    const glowColor = avatarState === "speaking" ? "rgba(59, 130, 246, 0.5)" :
                      avatarState === "listening" ? "rgba(34, 197, 94, 0.5)" :
                      avatarState === "thinking" ? "rgba(234, 179, 8, 0.5)" : "transparent";

    return (
      <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900">
        {/* Glow effect based on state */}
        <div 
          className="absolute w-64 h-64 rounded-full blur-3xl transition-all duration-300"
          style={{ backgroundColor: glowColor }}
        />
        
        <svg 
          viewBox="0 0 300 350" 
          className="w-64 h-80 relative z-10"
          style={{ transform: `scale(${breatheScale})` }}
        >
          {/* Hair */}
          <ellipse cx="150" cy="100" rx="75" ry="60" fill="#4A3728" />
          <ellipse cx="150" cy="85" rx="70" ry="45" fill="#5D4037" />
          
          {/* Face */}
          <ellipse cx="150" cy="150" rx="65" ry="75" fill={faceColor} className="transition-colors duration-300" />
          
          {/* Ears */}
          <ellipse cx="85" cy="150" rx="12" ry="18" fill={faceColor} />
          <ellipse cx="215" cy="150" rx="12" ry="18" fill={faceColor} />
          
          {/* Eyes */}
          <ellipse cx="120" cy={eyeY} rx="10" ry={eyeHeight} fill="#3E2723" className="transition-all duration-100" />
          <ellipse cx="180" cy={eyeY} rx="10" ry={eyeHeight} fill="#3E2723" className="transition-all duration-100" />
          
          {/* Eye shine */}
          {!eyeBlink && (
            <>
              <circle cx="123" cy="137" r="3" fill="white" opacity="0.8" />
              <circle cx="183" cy="137" r="3" fill="white" opacity="0.8" />
            </>
          )}
          
          {/* Eyebrows */}
          <path d="M105 125 Q120 120 135 125" stroke="#4A3728" strokeWidth="3" fill="none" />
          <path d="M165 125 Q180 120 195 125" stroke="#4A3728" strokeWidth="3" fill="none" />
          
          {/* Nose */}
          <path d="M150 150 Q155 165 150 170 Q145 165 150 150" fill="#E8B89D" />
          
          {/* Mouth */}
          <ellipse 
            cx="150" 
            cy={mouthY} 
            rx="20" 
            ry={mouthHeight} 
            fill="#C62828"
            className="transition-all duration-75"
          />
          {mouthOpen > 0.3 && (
            <ellipse cx="150" cy={mouthY + 2} rx="14" ry={mouthHeight * 0.6} fill="#8B0000" />
          )}
          
          {/* Neck */}
          <rect x="130" y="220" width="40" height="40" fill={faceColor} />
          
          {/* Shoulders/Body */}
          <ellipse cx="150" cy="290" rx="80" ry="50" fill="#3B82F6" />
          <ellipse cx="150" cy="280" rx="70" ry="35" fill="#60A5FA" />
        </svg>

        {/* State indicator */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full">
          <div className={`w-2 h-2 rounded-full ${
            avatarState === "speaking" ? "bg-blue-500 animate-pulse" :
            avatarState === "listening" ? "bg-green-500 animate-pulse" :
            avatarState === "thinking" ? "bg-yellow-500 animate-pulse" :
            "bg-gray-500"
          }`} />
          <span className="text-white text-sm capitalize">{avatarState}</span>
        </div>
      </div>
    );
  };

  if (!isActive) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl">
        <div className="text-center text-white/60">
          <div className="w-32 h-32 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
            <Phone className="w-16 h-16" />
          </div>
          <p>Ready to start call</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Avatar display */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        {renderAvatar()}
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <Button
          size="icon"
          variant={isMicOn ? "default" : "destructive"}
          onClick={onMicToggle}
          data-testid="button-mic-toggle"
        >
          {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </Button>
        <Button
          size="icon"
          variant={isSpeakerOn ? "default" : "secondary"}
          onClick={() => setIsSpeakerOn(!isSpeakerOn)}
          data-testid="button-speaker-toggle"
        >
          {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </Button>
        <Button
          size="icon"
          variant="destructive"
          onClick={handleEndCall}
          data-testid="button-end-call-avatar"
        >
          <Phone className="w-5 h-5 rotate-[135deg]" />
        </Button>
      </div>
    </div>
  );
}
