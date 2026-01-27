import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, VideoOff } from "lucide-react";

interface TavusAvatarProps {
  isActive: boolean;
  isCameraOn?: boolean;
  isMicOn?: boolean;
  onConversationStart?: (conversationId: string) => void;
  onConversationEnd?: () => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>, conversationId: string) => Promise<string>;
  onTranscript?: (role: "user" | "assistant", content: string) => void;
  className?: string;
}

export function TavusAvatar({ 
  isActive, 
  isCameraOn = true,
  isMicOn = true,
  onConversationStart, 
  onConversationEnd,
  onToolCall,
  onTranscript,
  className 
}: TavusAvatarProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Store callbacks and IDs in refs
  const onToolCallRef = useRef(onToolCall);
  const onTranscriptRef = useRef(onTranscript);
  const conversationIdRef = useRef(conversationId);
  
  useEffect(() => { onToolCallRef.current = onToolCall; }, [onToolCall]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  const startConversation = useCallback(async () => {
    if (isLoading || conversationUrl) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/tavus/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      
      if (!response.ok) {
        // Check for specific error messages
        const errorMessage = data.details || data.error || "Failed to start conversation";
        if (errorMessage.includes("out of conversational credits")) {
          throw new Error("Tavus account is out of credits. Please add more credits to your Tavus account.");
        }
        throw new Error(errorMessage);
      }

      console.log("Tavus conversation created:", data);
      
      if (data.conversation_url) {
        setConversationUrl(data.conversation_url);
        setConversationId(data.conversation_id);
        onConversationStart?.(data.conversation_id);
      } else {
        throw new Error("No conversation URL received");
      }
    } catch (err) {
      console.error("Failed to start Tavus conversation:", err);
      setError(err instanceof Error ? err.message : "Failed to start video avatar");
      setIsLoading(false);
    }
  }, [isLoading, conversationUrl, onConversationStart]);

  const endConversation = useCallback(async () => {
    const currentConvId = conversationIdRef.current;
    
    if (currentConvId) {
      try {
        await fetch(`/api/tavus/conversation/${currentConvId}/end`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Failed to end Tavus conversation:", err);
      }
    }
    
    setConversationUrl(null);
    setConversationId(null);
    setIsConnected(false);
    setIsLoading(false);
    onConversationEnd?.();
  }, [onConversationEnd]);

  // Listen for messages from the Tavus iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Accept messages from tavus.daily.co domain
      if (!event.origin.includes("daily.co") && !event.origin.includes("tavus")) return;
      
      const data = event.data;
      if (!data || typeof data !== "object") return;
      
      console.log("Tavus iframe message:", data);
      
      // Handle tool call events
      if (data.type === "tool_call" || data.action === "tool_call" || data.event_type === "conversation.tool_call") {
        const toolName = data.name || data.tool_name || data.properties?.name;
        let args = data.arguments || data.properties?.arguments || {};
        
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        
        console.log("Tool call from iframe:", toolName, args);
        
        const currentOnToolCall = onToolCallRef.current;
        const currentConvId = conversationIdRef.current;
        
        if (currentOnToolCall && currentConvId && toolName) {
          try {
            const result = await currentOnToolCall(toolName, args, currentConvId);
            
            // Echo result back to Tavus
            await fetch(`/api/tavus/conversation/${currentConvId}/echo`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: result }),
            });
          } catch (err) {
            console.error("Tool call execution failed:", err);
          }
        }
      }
      
      // Handle transcript events
      if (data.type === "utterance" || data.event_type === "conversation.utterance") {
        const role = data.role === "replica" ? "assistant" : "user";
        const content = data.content || data.text || "";
        const currentOnTranscript = onTranscriptRef.current;
        if (content && currentOnTranscript) {
          currentOnTranscript(role, content);
        }
      }
      
      // Handle connection events
      if (data.action === "joined-meeting" || data.type === "joined-meeting") {
        console.log("Tavus: joined meeting via postMessage");
        setIsConnected(true);
        setIsLoading(false);
      }
    };
    
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    console.log("Tavus iframe loaded");
    // Give it a moment to fully initialize, then consider connected
    setTimeout(() => {
      setIsConnected(true);
      setIsLoading(false);
    }, 2000);
  }, []);

  // Start/end conversation based on isActive
  useEffect(() => {
    if (isActive && !conversationUrl && !isLoading) {
      startConversation();
    } else if (!isActive && conversationUrl) {
      endConversation();
    }
  }, [isActive, conversationUrl, isLoading, startConversation, endConversation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const convId = conversationIdRef.current;
      if (convId) {
        fetch(`/api/tavus/conversation/${convId}/end`, { method: "POST" }).catch(() => {});
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
          <p className="text-sm text-white/70 text-center max-w-xs">{error}</p>
          <Button variant="secondary" onClick={() => { setError(null); startConversation(); }} data-testid="button-retry-tavus">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900 to-black", className)}>
      {/* Loading overlay */}
      {(isLoading || (conversationUrl && !isConnected)) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black">
          <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center">
            <Loader2 className="w-16 h-16 text-primary animate-spin" />
          </div>
          <p className="text-sm text-white/70 mt-4">Connecting to AI agent...</p>
        </div>
      )}
      
      {/* Tavus iframe - use direct embed */}
      {conversationUrl && (
        <iframe
          ref={iframeRef}
          src={conversationUrl}
          onLoad={handleIframeLoad}
          className="w-full h-full border-0 rounded-2xl"
          style={{ minHeight: "400px" }}
          allow="camera; microphone; autoplay; display-capture"
          data-testid="tavus-video-iframe"
        />
      )}
      
      {/* Placeholder when no conversation */}
      {!conversationUrl && !isLoading && (
        <div 
          className="w-full h-full flex items-center justify-center"
          style={{ minHeight: "400px" }}
          data-testid="tavus-video-placeholder"
        >
          <div className="text-white/50 text-sm">Video will appear here</div>
        </div>
      )}
      
      {/* Camera off overlay */}
      {isConnected && !isCameraOn && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5">
          <VideoOff className="w-4 h-4 text-white/70" />
          <span className="text-xs text-white/70">Camera off</span>
        </div>
      )}
      
      {/* Connection indicator */}
      {isConnected && (
        <div className="absolute top-4 left-4">
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-white/80 font-medium">Connected</span>
          </div>
        </div>
      )}
    </div>
  );
}
