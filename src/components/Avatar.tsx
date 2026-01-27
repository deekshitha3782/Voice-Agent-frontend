import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AvatarProps {
  isSpeaking: boolean;
  isListening: boolean;
  isProcessing: boolean;
  className?: string;
}

export function VoiceAvatar({ isSpeaking, isListening, isProcessing, className }: AvatarProps) {
  const [waveHeights, setWaveHeights] = useState<number[]>([0.3, 0.5, 0.7, 0.5, 0.3]);

  useEffect(() => {
    if (!isSpeaking) {
      setWaveHeights([0.3, 0.5, 0.7, 0.5, 0.3]);
      return;
    }

    const interval = setInterval(() => {
      setWaveHeights(prev => 
        prev.map(() => 0.2 + Math.random() * 0.8)
      );
    }, 100);

    return () => clearInterval(interval);
  }, [isSpeaking]);

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Outer glow ring */}
      <div 
        className={cn(
          "absolute w-64 h-64 rounded-full transition-all duration-500",
          isSpeaking && "animate-glow",
          isListening && "bg-accent/20 animate-pulse-ring",
          isProcessing && "bg-primary/10"
        )}
      />
      
      {/* Middle ring */}
      <div 
        className={cn(
          "absolute w-56 h-56 rounded-full border-2 transition-all duration-300",
          isSpeaking ? "border-primary/60" : "border-border/40",
          isListening && "border-accent/60"
        )}
      />

      {/* Inner circle - Avatar container */}
      <div 
        className={cn(
          "relative w-48 h-48 rounded-full bg-gradient-to-br from-card to-muted",
          "flex items-center justify-center overflow-hidden",
          "border-2 transition-all duration-300",
          isSpeaking ? "border-primary shadow-lg shadow-primary/20" : "border-border",
          isListening && "border-accent shadow-lg shadow-accent/20"
        )}
      >
        {/* Avatar face */}
        <div className="relative flex flex-col items-center justify-center">
          {/* Eyes */}
          <div className="flex gap-8 mb-4">
            <div 
              className={cn(
                "w-4 h-4 rounded-full bg-foreground transition-all duration-200",
                isSpeaking && "scale-110",
                isListening && "animate-pulse"
              )}
            />
            <div 
              className={cn(
                "w-4 h-4 rounded-full bg-foreground transition-all duration-200",
                isSpeaking && "scale-110",
                isListening && "animate-pulse"
              )}
            />
          </div>
          
          {/* Mouth / Voice waves */}
          <div className="flex items-end gap-1 h-8">
            {waveHeights.map((height, i) => (
              <div
                key={i}
                className={cn(
                  "w-2 rounded-full transition-all duration-100",
                  isSpeaking ? "bg-primary" : isListening ? "bg-accent" : "bg-muted-foreground/50"
                )}
                style={{ 
                  height: `${(isSpeaking || isListening) ? height * 24 : 4}px`,
                  transitionDelay: `${i * 30}ms`
                }}
              />
            ))}
          </div>
        </div>

        {/* Processing spinner overlay */}
        {isProcessing && !isSpeaking && !isListening && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/50">
            <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div 
        className={cn(
          "absolute bottom-2 left-1/2 -translate-x-1/2",
          "px-3 py-1 rounded-full text-xs font-medium",
          "transition-all duration-300",
          isSpeaking && "bg-primary text-primary-foreground",
          isListening && "bg-accent text-accent-foreground",
          isProcessing && !isSpeaking && !isListening && "bg-muted text-muted-foreground",
          !isSpeaking && !isListening && !isProcessing && "bg-secondary text-secondary-foreground"
        )}
      >
        {isSpeaking ? "Speaking" : isListening ? "Listening" : isProcessing ? "Thinking" : "Ready"}
      </div>
    </div>
  );
}
