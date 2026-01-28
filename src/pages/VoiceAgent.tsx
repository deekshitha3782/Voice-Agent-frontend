import { useState, useCallback, useRef, useEffect } from "react";
import { BeyAvatar, type BeyAvatarHandle } from "@/components/BeyAvatar";
import { ConversationPanel, type Message } from "@/components/ConversationPanel";
import { ToolCallDisplay, type ToolCallData } from "@/components/ToolCallDisplay";
import { CallSummary, type CallSummaryData } from "@/components/CallSummary";
import { VoiceControls } from "@/components/VoiceControls";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Info, Calendar, Search, MessageCircle, Video, User, Loader2, X, Edit, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Ensure the API URL has https:// protocol
const rawApiUrl = import.meta.env.VITE_API_BASE_URL || "";
const API_BASE_URL = rawApiUrl && !rawApiUrl.startsWith("http") 
  ? `https://${rawApiUrl}` 
  : rawApiUrl;

interface UserData {
  id: number;
  phoneNumber: string;
  name?: string | null;
}

interface AppointmentData {
  id: number;
  userId: number;
  date: string;
  time: string;
  description?: string | null;
  status: string;
}

export default function VoiceAgent() {
  const { toast } = useToast();
  
  const [isCallActive, setIsCallActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallData[]>([]);
  const [callSummary, setCallSummary] = useState<CallSummaryData | null>(null);
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [useBey, setUseBey] = useState(true);
  const [beyCallId, setBeyCallId] = useState<string | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [beyQuotaExceeded, setBeyQuotaExceeded] = useState(false);
  const useBeyRef = useRef(true);
  
  // User identification state
  const [phoneInput, setPhoneInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [identifiedUser, setIdentifiedUser] = useState<UserData | null>(null);
  const [userAppointments, setUserAppointments] = useState<AppointmentData[]>([]);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [autoDetectedPhone, setAutoDetectedPhone] = useState(false);
  const autoDetectionTriggeredRef = useRef(false);
  const recentUserSpeechRef = useRef<string[]>([]);
  const beyAvatarRef = useRef<BeyAvatarHandle>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadAudioContextRef = useRef<AudioContext | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef(false);
  const isMicPausedRef = useRef(false);
  const isCallActiveRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const startListeningRef = useRef<() => Promise<void>>();
  const sendVoiceMessageRef = useRef<(audioBlob: Blob) => Promise<void>>();
  
  // Keep refs in sync with state for use in callbacks
  useEffect(() => { isCallActiveRef.current = isCallActive; }, [isCallActive]);

  // Refs to track processing/speaking state for use in callbacks
  const isProcessingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { useBeyRef.current = useBey; }, [useBey]);

  // Centralized auto-restart function with proper guards
  const scheduleAutoRestart = useCallback((delay = 300) => {
    // Clear any pending restart
    if (autoRestartTimeoutRef.current) {
      clearTimeout(autoRestartTimeoutRef.current);
      autoRestartTimeoutRef.current = null;
    }
    
    autoRestartTimeoutRef.current = setTimeout(() => {
      autoRestartTimeoutRef.current = null;
      
      // Only restart if ALL conditions are met
      if (
        isCallActiveRef.current &&
        !isRecordingRef.current &&
        !isMicPausedRef.current &&
        !isProcessingRef.current &&
        !isSpeakingRef.current
      ) {
        startListeningRef.current?.();
      }
    }, delay);
  }, []);

  // Extract phone number from text (handles various formats including spoken numbers)
  const extractPhoneNumber = useCallback((text: string): string | null => {
    // Normalize spoken number words to digits
    const numberWords: Record<string, string> = {
      'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
      'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
      'oh': '0', 'o': '0'
    };
    
    let normalized = text.toLowerCase();
    Object.entries(numberWords).forEach(([word, digit]) => {
      normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
    });
    
    // Remove common separators and extract digits
    const cleanedDigits = normalized.replace(/[\s\-\(\)\.\,]/g, '');
    
    // Find sequences of 10+ digits (phone numbers)
    const phoneMatch = cleanedDigits.match(/\d{10,}/);
    if (phoneMatch) {
      // Return last 10 digits (handles country codes)
      return phoneMatch[0].slice(-10);
    }
    
    // Also try to find patterns like "9 6 8 6 4 5 6 0 9 0"
    const spacedDigits = normalized.match(/(\d\s*){10,}/);
    if (spacedDigits) {
      const digits = spacedDigits[0].replace(/\D/g, '');
      if (digits.length >= 10) {
        return digits.slice(-10);
      }
    }
    
    return null;
  }, []);

  // Extract name from text
  const extractName = useCallback((text: string): string | null => {
    const lowerText = text.toLowerCase();
    
    // Patterns like "my name is X", "I'm X", "I am X", "this is X", "call me X"
    const namePatterns = [
      /my name is\s+([a-z]+)/i,
      /i(?:'m| am)\s+([a-z]+)/i,
      /this is\s+([a-z]+)/i,
      /call me\s+([a-z]+)/i,
      /name(?:'s| is)\s+([a-z]+)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // Filter out common false positives
        const name = match[1];
        const falsePositives = ['calling', 'looking', 'trying', 'here', 'there', 'asking', 'booking'];
        if (!falsePositives.includes(name.toLowerCase())) {
          return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        }
      }
    }
    
    return null;
  }, []);

  // Send appointment context to Beyond Presence so the AI knows about user's appointments
  const sendAppointmentContext = useCallback((userName: string | null | undefined, appointments: AppointmentData[]) => {
    if (!beyAvatarRef.current) return;
    
    const activeAppts = appointments.filter(a => a.status !== "cancelled");
    let contextMessage = "";
    
    if (activeAppts.length > 0) {
      const apptList = activeAppts.map(a => 
        `- ${a.date} at ${a.time}: ${a.description || "General appointment"} (Status: ${a.status})`
      ).join("\n");
      contextMessage = `[System note: User ${userName || "identified"}. Their appointments from database:\n${apptList}\nPlease use ONLY this data when discussing their appointments.]`;
    } else {
      contextMessage = `[System note: User ${userName || "identified"} has NO appointments scheduled. Do not make up any appointments.]`;
    }
    
    console.log("Sending appointment context to Beyond Presence:", contextMessage);
    beyAvatarRef.current.sendContext(contextMessage);
  }, []);

  // Auto lookup user when phone is detected
  const autoLookupUser = useCallback(async (phone: string, name?: string) => {
    if (identifiedUser || isLookingUp || autoDetectionTriggeredRef.current) return;
    
    autoDetectionTriggeredRef.current = true;
    setAutoDetectedPhone(true);
    setPhoneInput(phone);
    if (name) setNameInput(name);
    
    // Clear speech buffer to prevent re-triggering on same data
    recentUserSpeechRef.current = [];
    
    setIsLookingUp(true);
    try {
      const response = await apiRequest("POST", "/api/users/lookup", {
        phoneNumber: phone,
        name: name || undefined,
        callId: beyCallId,
      });
      const data = await response.json();
      
      setIdentifiedUser(data.user);
      setUserAppointments(data.appointments || []);
      
      toast({
        title: data.isNew ? "User identified!" : "User found!",
        description: data.appointments?.length > 0 
          ? `Found ${data.appointments.length} appointment(s)`
          : data.isNew 
            ? `Account created for ${data.user.name || phone.slice(-4)}`
            : "No appointments found. You can ask the AI to book one!",
      });
    } catch (error) {
      console.error("Auto lookup error:", error);
      // Add cooldown before allowing retry - wait 5 seconds
      setTimeout(() => {
        autoDetectionTriggeredRef.current = false;
      }, 5000);
    } finally {
      setIsLookingUp(false);
    }
  }, [identifiedUser, isLookingUp, beyCallId, toast]);

  // User lookup function (manual) - auto-refreshes call when appointments found
  const lookupUser = useCallback(async () => {
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 10) {
      toast({
        title: "Invalid phone number",
        description: "Please enter a valid 10-digit phone number",
        variant: "destructive",
      });
      return;
    }
    
    setIsLookingUp(true);
    try {
      const response = await apiRequest("POST", "/api/users/lookup", {
        phoneNumber: digits,
        name: nameInput || undefined,
        callId: beyCallId,
      });
      const data = await response.json();
      
      setIdentifiedUser(data.user);
      setUserAppointments(data.appointments || []);
      
      if (data.appointments && data.appointments.length > 0) {
        toast({
          title: "Found your appointments!",
          description: `You have ${data.appointments.length} appointment(s)`,
        });
      } else if (data.isNew) {
        toast({
          title: "Welcome!",
          description: `Account created for ${data.user.name || "phone ending in " + digits.slice(-4)}`,
        });
      } else {
        toast({
          title: "Welcome back!",
          description: "No appointments found. You can ask the AI to book one!",
        });
      }
    } catch (error) {
      console.error("User lookup error:", error);
      toast({
        title: "Lookup failed",
        description: "Could not find or create user",
        variant: "destructive",
      });
    } finally {
      setIsLookingUp(false);
    }
  }, [phoneInput, nameInput, beyCallId, toast]);
  
  // Cancel appointment function
  const cancelAppointment = useCallback(async (appointmentId: number) => {
    try {
      await apiRequest("POST", "/api/bey/tool-execute", {
        tool_name: "cancel_appointment",
        arguments: { appointment_id: appointmentId },
        call_id: beyCallId,
      });
      
      // Refresh appointments
      setUserAppointments(prev => prev.filter(a => a.id !== appointmentId));
      
      toast({
        title: "Appointment cancelled",
        description: "Your appointment has been cancelled successfully",
      });
    } catch (error) {
      console.error("Cancel error:", error);
      toast({
        title: "Cancel failed",
        description: "Could not cancel appointment",
        variant: "destructive",
      });
    }
  }, [beyCallId, toast]);

  const initAudio = useCallback(async () => {
    if (audioContextRef.current) return;
    
    // Non-blocking audio initialization - errors won't prevent call from starting
    try {
      if (typeof AudioContext === "undefined") {
        console.warn("AudioContext not available");
        return;
      }
      
      const ctx = new AudioContext({ sampleRate: 24000 });
      
      if (!ctx.audioWorklet) {
        console.warn("AudioWorklet not available");
        return;
      }
      
      // Add a timeout to prevent hanging in unsupported environments
      const modulePromise = ctx.audioWorklet.addModule("/audio-playback-worklet.js");
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Audio init timeout")), 3000)
      );
      
      await Promise.race([modulePromise, timeoutPromise]);
      
      const worklet = new AudioWorkletNode(ctx, "audio-playback-processor");
      worklet.connect(ctx.destination);
      
      worklet.port.onmessage = (e) => {
        if (e.data.type === "ended") {
          setIsSpeaking(false);
          // Auto-restart listening after audio playback ends using centralized function
          scheduleAutoRestart(300);
        }
      };
      
      audioContextRef.current = ctx;
      workletRef.current = worklet;
      console.log("Audio initialized successfully");
    } catch (error) {
      console.warn("Audio initialization skipped:", error);
      // Don't throw or show toast - audio is optional
    }
  }, []);

  const decodePCM16ToFloat32 = (base64Audio: string): Float32Array => {
    const raw = atob(base64Audio);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }
    return float32;
  };

  const playAudio = useCallback((base64Audio: string) => {
    if (!workletRef.current || isMuted) return;
    const samples = decodePCM16ToFloat32(base64Audio);
    workletRef.current.port.postMessage({ type: "audio", samples });
    setIsSpeaking(true);
  }, [isMuted]);

  const clearAudio = useCallback(() => {
    workletRef.current?.port.postMessage({ type: "clear" });
    setIsSpeaking(false);
  }, []);

  const signalAudioComplete = useCallback(() => {
    workletRef.current?.port.postMessage({ type: "streamComplete" });
  }, []);

  // Voice Activity Detection - detect when user stops speaking
  const startVoiceDetection = useCallback(() => {
    if (!analyserRef.current) return;
    
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const SILENCE_THRESHOLD = 15; // Volume level below which is considered silence
    const SILENCE_DURATION = 1500; // ms of silence before sending
    
    let lastSoundTime = Date.now();
    let hasSpoken = false;
    
    const checkAudioLevel = () => {
      if (!isRecordingRef.current) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      
      if (average > SILENCE_THRESHOLD) {
        lastSoundTime = Date.now();
        hasSpoken = true;
      } else if (hasSpoken && Date.now() - lastSoundTime > SILENCE_DURATION) {
        // User stopped speaking - send the audio
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
          isRecordingRef.current = false;
          setIsListening(false);
        }
        return;
      }
      
      requestAnimationFrame(checkAudioLevel);
    };
    
    checkAudioLevel();
  }, []);

  // Start continuous listening
  const startListening = useCallback(async () => {
    if (isRecordingRef.current || isProcessing || isSpeaking) return;
    
    try {
      // Reuse existing stream or create new one
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Set up analyser for voice activity detection - reuse AudioContext
        if (!vadAudioContextRef.current) {
          vadAudioContextRef.current = new AudioContext();
        }
        const source = vadAudioContextRef.current.createMediaStreamSource(streamRef.current);
        const analyser = vadAudioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
      }
      
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: "audio/webm;codecs=opus",
      });
      
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        if (audioBlob.size > 1000) { // Only send if there's substantial audio
          await sendVoiceMessageRef.current?.(audioBlob);
        } else {
          // If audio was too short, use centralized restart with guards
          scheduleAutoRestart(100);
        }
      };
      
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      isRecordingRef.current = true;
      setIsListening(true);
      
      // Start voice activity detection
      startVoiceDetection();
      
      // Safety timeout - max 30 seconds of recording
      silenceTimeoutRef.current = setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
          isRecordingRef.current = false;
          setIsListening(false);
        }
      }, 30000);
      
    } catch (error) {
      console.error("Failed to start listening:", error);
      toast({
        title: "Microphone Error",
        description: "Please allow microphone access to use voice features",
        variant: "destructive",
      });
    }
  }, [isProcessing, isSpeaking, isCallActive, startVoiceDetection, toast, scheduleAutoRestart]);
  
  // Keep startListeningRef updated
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Stop listening and clean up
  const stopListening = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    
    isRecordingRef.current = false;
    setIsListening(false);
  }, []);

  const startCall = useCallback(async () => {
    try {
      // Initialize audio but don't block on failure
      await initAudio().catch(() => {});
      
      // Request microphone permission only if NOT using Beyond Presence
      // Beyond Presence handles its own audio through LiveKit
      if (!useBey) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          
          // Set up analyser for voice activity detection
          if (!vadAudioContextRef.current) {
            vadAudioContextRef.current = new AudioContext();
          }
          const source = vadAudioContextRef.current.createMediaStreamSource(stream);
          const analyser = vadAudioContextRef.current.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;
        } catch (micError) {
          console.error("Microphone access denied:", micError);
          toast({
            title: "Microphone Required",
            description: "Please allow microphone access to use voice features",
            variant: "destructive",
          });
          return;
        }
      }
      
      const response = await fetch(`${API_BASE_URL}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneInput }),
      });
      
      if (!response.ok) throw new Error("Failed to start session");
      
      const session = await response.json();
      setSessionId(session.id);
      setIsCallActive(true);
      setCallStartTime(new Date());
      setMessages([]);
      setToolCalls([]);
      setCallSummary(null);
      isMicPausedRef.current = false;
      
      // Reset user identification for new call
      setIdentifiedUser(null);
      setUserAppointments([]);
      setNameInput("");
      setAutoDetectedPhone(false);
      autoDetectionTriggeredRef.current = false;
      recentUserSpeechRef.current = [];
      
      // Only show local welcome message if NOT using Beyond Presence (Bey has its own greeting)
      if (!useBey) {
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: "Hello! I'm your AI scheduling assistant. I can help you book, view, modify, or cancel appointments. To get started, could you please tell me your phone number so I can identify you?",
          timestamp: new Date(),
        }]);
      }
      
      toast({
        title: "Call Started",
        description: useBey ? "Connected to AI avatar" : "Speak naturally - I'm listening!",
      });
      
      // Only auto-start listening if NOT using Beyond Presence (Bey handles its own voice input)
      if (!useBey) {
        scheduleAutoRestart(500);
      }
    } catch (error) {
      console.error("Failed to start call:", error);
      toast({
        title: "Error",
        description: "Failed to start the call. Please try again.",
        variant: "destructive",
      });
    }
  }, [initAudio, toast, scheduleAutoRestart, useBey, phoneInput]);

  const endCall = useCallback(async () => {
    if (!sessionId) return;
    
    // Immediately prevent any auto-restarts
    isCallActiveRef.current = false;
    if (autoRestartTimeoutRef.current) {
      clearTimeout(autoRestartTimeoutRef.current);
      autoRestartTimeoutRef.current = null;
    }
    
    setIsProcessing(true);
    clearAudio();
    stopListening();
    
    // Clean up microphone stream and VAD resources
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    if (vadAudioContextRef.current) {
      vadAudioContextRef.current.close().catch(() => {});
      vadAudioContextRef.current = null;
    }
    
    try {
      // Format messages into a transcript string
      const transcript = messages
        .map(m => `${m.role === "assistant" ? "AI" : "User"}: ${m.content}`)
        .join("\n");
      
      const response = await fetch(`/api/sessions/${sessionId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      
      if (!response.ok) throw new Error("Failed to end session");
      
      const summary = await response.json();
      
      const endTime = new Date();
      const duration = callStartTime 
        ? Math.round((endTime.getTime() - callStartTime.getTime()) / 1000)
        : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      
      // Calculate cost breakdown
      const beyondPresenceMinutes = duration / 60;
      const beyondPresenceCost = beyondPresenceMinutes * 0.50; // $0.50 per minute
      const openAiSummaryCost = 0.001; // ~$0.001 per summary call (GPT-4o-mini)
      const totalCost = beyondPresenceCost + openAiSummaryCost;
      
      setCallSummary({
        sessionId: sessionId,
        duration: `${minutes}:${seconds.toString().padStart(2, "0")}`,
        durationSeconds: duration,
        userName: summary.userName,
        phoneNumber: summary.phoneNumber,
        summary: summary.summary,
        appointments: summary.appointments || [],
        userPreferences: summary.userPreferences || [],
        timestamp: endTime,
        costBreakdown: {
          beyondPresenceMinutes,
          beyondPresenceCost,
          openAiSummaryCost,
          totalCost,
        },
      });
      
      setIsCallActive(false);
      setIsListening(false);
      setIsSpeaking(false);
    } catch (error) {
      console.error("Failed to end call:", error);
      toast({
        title: "Error",
        description: "Failed to generate call summary",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, callStartTime, clearAudio, stopListening, toast, messages]);

  const sendVoiceMessage = useCallback(async (audioBlob: Blob) => {
    if (!sessionId) return;
    
    setIsProcessing(true);
    setCurrentTranscript("");
    
    try {
      const base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(audioBlob);
      });
      
      const response = await fetch(`/api/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio }),
      });
      
      if (!response.ok) throw new Error("Failed to send message");
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantTranscript = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          
          try {
            const event = JSON.parse(line.slice(6));
            
            switch (event.type) {
              case "user_transcript":
                setMessages(prev => [...prev, {
                  id: `user-${Date.now()}`,
                  role: "user",
                  content: event.data,
                  timestamp: new Date(),
                }]);
                break;
                
              case "tool_call_start":
                setToolCalls(prev => [...prev, {
                  id: event.id,
                  name: event.name,
                  parameters: event.parameters,
                  status: "running",
                }]);
                break;
                
              case "tool_call_end":
                setToolCalls(prev => prev.map(tc => 
                  tc.id === event.id 
                    ? { ...tc, result: event.result, status: "completed" }
                    : tc
                ));
                break;
                
              case "transcript":
                assistantTranscript += event.data;
                setCurrentTranscript(assistantTranscript);
                break;
                
              case "audio":
                // Only play OpenAI TTS if not using Beyond Presence (Bey handles its own audio)
                if (!useBeyRef.current) {
                  playAudio(event.data);
                }
                break;
                
              case "done":
                signalAudioComplete();
                if (assistantTranscript) {
                  setMessages(prev => [...prev, {
                    id: `assistant-${Date.now()}`,
                    role: "assistant",
                    content: assistantTranscript,
                    timestamp: new Date(),
                  }]);
                }
                setCurrentTranscript("");
                
                if (event.endCall) {
                  await endCall();
                } else {
                  // Restart listening after AI finishes speaking using centralized function
                  scheduleAutoRestart(500);
                }
                break;
                
              case "error":
                throw new Error(event.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) {
              console.error("SSE parsing error:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to send voice message:", error);
      toast({
        title: "Error",
        description: "Failed to process your message",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, playAudio, signalAudioComplete, endCall, toast, scheduleAutoRestart]);
  
  // Keep sendVoiceMessageRef updated
  useEffect(() => {
    sendVoiceMessageRef.current = sendVoiceMessage;
  }, [sendVoiceMessage]);

  // Toggle mic manually (for pausing/resuming listening)
  const toggleMic = useCallback(() => {
    if (isListening) {
      isMicPausedRef.current = true;
      stopListening();
    } else {
      isMicPausedRef.current = false;
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
    if (!isMuted) {
      clearAudio();
    }
  }, [isMuted, clearAudio]);

  const toggleCamera = useCallback(() => {
    setIsCameraOn(prev => !prev);
  }, []);

  const handleNewCall = useCallback(() => {
    setCallSummary(null);
    setIdentifiedUser(null);
    setUserAppointments([]);
    setPhoneInput("");
    setNameInput("");
    startCall();
  }, [startCall]);

  // Auto-restart listening when conditions are right (continuous conversation mode)
  // Only runs when NOT using Beyond Presence (Bey handles its own voice input)
  useEffect(() => {
    if (!useBey && isCallActive && !isListening && !isProcessing && !isSpeaking) {
      scheduleAutoRestart(500);
    }
    return () => {
      if (autoRestartTimeoutRef.current) {
        clearTimeout(autoRestartTimeoutRef.current);
        autoRestartTimeoutRef.current = null;
      }
    };
  }, [useBey, isCallActive, isListening, isProcessing, isSpeaking, scheduleAutoRestart]);

  useEffect(() => {
    return () => {
      // Clean up on unmount
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Phone className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold">AI Voice Agent</h1>
              <p className="text-xs text-muted-foreground">Appointment Scheduling Assistant</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {isCallActive && (
              <Badge variant="secondary" className="bg-green-500/10 text-green-500">
                <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
                Call Active
              </Badge>
            )}
            <Button variant="ghost" size="icon" data-testid="button-info">
              <Info className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {!isCallActive && !callSummary ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <Phone className="w-16 h-16 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">Ready to Assist</h2>
            <p className="text-muted-foreground mb-4 max-w-md">
              Start a call to book, view, modify, or cancel appointments with our AI voice assistant.
            </p>
            
            {/* Required phone input for personalized service */}
            <div className="mb-6 w-full max-w-sm">
              <label className="block text-sm font-medium mb-2">
                Enter your phone number to access your appointments:
              </label>
              <Input
                type="tel"
                placeholder="e.g., 555-123-4567"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="text-center text-lg"
                data-testid="input-phone-precall"
              />
              {phoneInput && phoneInput.replace(/\D/g, "").length >= 10 ? (
                <p className="text-xs text-green-600 mt-2">
                  Your appointments will be loaded for this call.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">
                  Please enter your phone number to start a call.
                </p>
              )}
            </div>
            
            <Button 
              size="lg" 
              onClick={startCall} 
              disabled={phoneInput.replace(/\D/g, "").length < 10}
              data-testid="button-start-call"
            >
              <Phone className="w-5 h-5 mr-2" />
              Start Call
            </Button>
            
            {phoneInput.replace(/\D/g, "").length < 10 && (
              <p className="text-xs text-muted-foreground mt-2">
                Enter a valid 10-digit phone number to begin
              </p>
            )}
            
            <div className="mt-12 grid gap-4 md:grid-cols-3 max-w-2xl">
              <Card className="p-4 text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-medium text-sm">Book Appointments</h3>
                <p className="text-xs text-muted-foreground mt-1">Schedule new appointments easily</p>
              </Card>
              <Card className="p-4 text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                  <Search className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-medium text-sm">View & Manage</h3>
                <p className="text-xs text-muted-foreground mt-1">Check and modify your bookings</p>
              </Card>
              <Card className="p-4 text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-medium text-sm">Natural Conversation</h3>
                <p className="text-xs text-muted-foreground mt-1">Speak naturally with the AI</p>
              </Card>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-12rem)]">
            {/* Main Video Call Area */}
            <div className="lg:flex-1 flex flex-col">
              {/* Video Container */}
              <div className="flex-1 relative rounded-2xl overflow-hidden bg-black min-h-[400px]">
                {useBey ? (
                  <BeyAvatar
                    ref={beyAvatarRef}
                    isActive={isCallActive}
                    isCameraOn={isCameraOn}
                    isMicOn={!isMuted}
                    phoneNumber={phoneInput}
                    onCallStart={(id) => setBeyCallId(id)}
                    onCallEnd={() => setBeyCallId(null)}
                    onQuotaExceeded={() => {
                      console.log("Beyond Presence quota exceeded");
                      setBeyQuotaExceeded(true);
                      toast({
                        title: "Service Unavailable",
                        description: "Beyond Presence quota exceeded. Please try again later.",
                        variant: "destructive",
                      });
                    }}
                    onTranscript={(role, content) => {
                      setMessages(prev => [...prev, {
                        id: `${role}-${Date.now()}`,
                        role,
                        content,
                        timestamp: new Date(),
                      }]);
                      
                      // Auto-detect phone number and name from user's speech
                      if (role === "user" && !identifiedUser && !autoDetectionTriggeredRef.current) {
                        // Accumulate recent user speech (phone numbers often span multiple messages)
                        recentUserSpeechRef.current.push(content);
                        // Keep only last 5 messages to avoid checking too much old text
                        if (recentUserSpeechRef.current.length > 5) {
                          recentUserSpeechRef.current.shift();
                        }
                        
                        // Check both individual message and combined recent speech
                        const combinedSpeech = recentUserSpeechRef.current.join(" ");
                        const detectedPhone = extractPhoneNumber(combinedSpeech) || extractPhoneNumber(content);
                        const detectedName = extractName(combinedSpeech) || extractName(content);
                        
                        if (detectedPhone) {
                          console.log("Auto-detected phone:", detectedPhone, "from:", combinedSpeech);
                          autoLookupUser(detectedPhone, detectedName || undefined);
                        } else if (detectedName && !nameInput) {
                          // Store name for later when phone is provided
                          setNameInput(detectedName);
                        }
                      }
                    }}
                    className="w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-slate-900 to-black">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center">
                        <Video className="w-16 h-16 text-primary" />
                      </div>
                      <p className="text-white/70 text-sm">
                        {isListening 
                          ? "Listening... Speak naturally"
                          : isProcessing 
                            ? "Processing your request..."
                            : isSpeaking 
                              ? "Speaking..."
                              : "Waiting to listen..."
                        }
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Status indicators overlay */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                  {isListening && (
                    <div className="flex items-center gap-2 bg-green-500/90 backdrop-blur-sm rounded-full px-3 py-1.5" data-testid="status-listening">
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      <span className="text-xs text-white font-medium">Listening</span>
                    </div>
                  )}
                  {isProcessing && (
                    <div className="flex items-center gap-2 bg-yellow-500/90 backdrop-blur-sm rounded-full px-3 py-1.5" data-testid="status-processing">
                      <span className="text-xs text-white font-medium">Processing...</span>
                    </div>
                  )}
                  {isSpeaking && (
                    <div className="flex items-center gap-2 bg-blue-500/90 backdrop-blur-sm rounded-full px-3 py-1.5" data-testid="status-speaking">
                      <span className="text-xs text-white font-medium">AI Speaking</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Video Call Controls */}
              <div className="py-6">
                <VoiceControls
                  isListening={isListening}
                  isCameraOn={isCameraOn}
                  isMuted={isMuted}
                  isCallActive={isCallActive}
                  onToggleMic={toggleMic}
                  onToggleCamera={toggleCamera}
                  onToggleMute={toggleMute}
                  onEndCall={endCall}
                  disabled={isProcessing}
                />
              </div>
            </div>
            
            {/* Side Panel - User Info, Conversation & Appointments */}
            <div className="lg:w-[400px] flex flex-col gap-4">
              {/* User Identification Panel */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <User className="w-4 h-4 text-primary" />
                  <h3 className="font-medium text-sm">Your Information</h3>
                  {isLookingUp && (
                    <Badge variant="secondary" className="ml-auto animate-pulse">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Detecting...
                    </Badge>
                  )}
                </div>
                
                {!identifiedUser ? (
                  <div className="space-y-3">
                    {autoDetectedPhone ? (
                      <div className="text-center py-2">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                          Phone auto-detected from conversation
                        </Badge>
                      </div>
                    ) : (
                      <div className="text-center py-2 px-3 rounded-lg bg-primary/5 border border-primary/10">
                        <p className="text-xs text-muted-foreground">
                          Tell the AI your phone number and we'll automatically find your appointments
                        </p>
                      </div>
                    )}
                    <div>
                      <Label htmlFor="phone" className="text-xs text-muted-foreground">Phone Number</Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="Or enter manually here"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        className="mt-1"
                        data-testid="input-phone"
                      />
                    </div>
                    <div>
                      <Label htmlFor="name" className="text-xs text-muted-foreground">Name (optional)</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Enter your name"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="mt-1"
                        data-testid="input-name"
                      />
                    </div>
                    <Button 
                      onClick={lookupUser} 
                      disabled={isLookingUp || phoneInput.length < 10}
                      className="w-full"
                      data-testid="button-lookup-user"
                    >
                      {isLookingUp ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Looking up...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          Find My Appointments
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{identifiedUser.name || "Guest"}</p>
                        <p className="text-xs text-muted-foreground">
                          Phone: ***-***-{identifiedUser.phoneNumber.slice(-4)}
                        </p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => {
                          setIdentifiedUser(null);
                          setUserAppointments([]);
                          setPhoneInput("");
                          setNameInput("");
                          setAutoDetectedPhone(false);
                          autoDetectionTriggeredRef.current = false;
                        }}
                        data-testid="button-clear-user"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <div className="border-t pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 text-primary" />
                        <h4 className="text-sm font-medium">Your Appointments</h4>
                        <Badge variant="secondary" className="ml-auto">{userAppointments.length}</Badge>
                      </div>
                      
                      {userAppointments.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          No appointments scheduled. Tell the AI assistant to book one!
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-[150px] overflow-auto">
                          {userAppointments.map((apt) => (
                            <div 
                              key={apt.id} 
                              className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                              data-testid={`appointment-${apt.id}`}
                            >
                              <div>
                                <p className="text-sm font-medium">{apt.date} at {apt.time}</p>
                                {apt.description && (
                                  <p className="text-xs text-muted-foreground">{apt.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Badge 
                                  variant="secondary"
                                  className={apt.status === "confirmed" ? "bg-green-500/10 text-green-600" : ""}
                                >
                                  {apt.status}
                                </Badge>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-7 w-7"
                                  onClick={() => cancelAppointment(apt.id)}
                                  data-testid={`button-cancel-apt-${apt.id}`}
                                >
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
              
              {/* Conversation Panel */}
              <Card className="flex-1 overflow-hidden min-h-[200px]">
                <ConversationPanel
                  messages={messages}
                  currentTranscript={currentTranscript}
                  isTyping={isProcessing && !currentTranscript}
                />
              </Card>
              
              {/* Tool Calls Panel */}
              <Card className="p-4 overflow-auto max-h-[150px]">
                <ToolCallDisplay toolCalls={toolCalls} />
                
                {toolCalls.length === 0 && (
                  <div className="flex items-center justify-center text-center py-2">
                    <p className="text-sm text-muted-foreground/70">
                      Actions will appear here
                    </p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </main>

      {/* Call Summary Modal */}
      {callSummary && (
        <CallSummary
          data={callSummary}
          onClose={() => setCallSummary(null)}
          onNewCall={handleNewCall}
        />
      )}
    </div>
  );
}
