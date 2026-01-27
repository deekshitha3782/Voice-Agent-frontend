import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface VoiceControlsProps {
  isListening: boolean;
  isCameraOn: boolean;
  isMuted: boolean;
  isCallActive: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onEndCall: () => void;
  disabled?: boolean;
  className?: string;
}

export function VoiceControls({
  isListening,
  isCameraOn,
  isMuted,
  isCallActive,
  onToggleMic,
  onToggleCamera,
  onToggleMute,
  onEndCall,
  disabled,
  className
}: VoiceControlsProps) {
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      {/* Camera Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isCameraOn ? "secondary" : "outline"}
            size="icon"
            onClick={onToggleCamera}
            disabled={disabled || !isCallActive}
            className={cn(
              "w-14 h-14 rounded-full transition-all",
              !isCameraOn && "bg-destructive/10 border-destructive/50 text-destructive hover:bg-destructive/20"
            )}
            data-testid="button-toggle-camera"
          >
            {isCameraOn ? (
              <Video className="w-6 h-6" />
            ) : (
              <VideoOff className="w-6 h-6" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isCameraOn ? "Turn off camera" : "Turn on camera"}
        </TooltipContent>
      </Tooltip>

      {/* Main Microphone Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isListening ? "default" : "outline"}
            size="icon"
            onClick={onToggleMic}
            disabled={disabled || !isCallActive}
            className={cn(
              "w-14 h-14 rounded-full transition-all",
              isListening && "ring-4 ring-primary/30",
              !isListening && "bg-destructive/10 border-destructive/50 text-destructive hover:bg-destructive/20"
            )}
            data-testid="button-toggle-mic"
          >
            {isListening ? (
              <Mic className="w-6 h-6" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isListening ? "Mute microphone" : "Unmute microphone"}
        </TooltipContent>
      </Tooltip>

      {/* Speaker/Audio Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={!isMuted ? "secondary" : "outline"}
            size="icon"
            onClick={onToggleMute}
            disabled={disabled || !isCallActive}
            className={cn(
              "w-14 h-14 rounded-full transition-all",
              isMuted && "bg-destructive/10 border-destructive/50 text-destructive hover:bg-destructive/20"
            )}
            data-testid="button-toggle-mute"
          >
            {isMuted ? (
              <VolumeX className="w-6 h-6" />
            ) : (
              <Volume2 className="w-6 h-6" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isMuted ? "Unmute speaker" : "Mute speaker"}
        </TooltipContent>
      </Tooltip>

      {/* End Call */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="destructive"
            size="icon"
            onClick={onEndCall}
            disabled={disabled || !isCallActive}
            className="w-14 h-14 rounded-full"
            data-testid="button-end-call"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>End call</TooltipContent>
      </Tooltip>
    </div>
  );
}
