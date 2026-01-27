import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Calendar, 
  User, 
  Clock, 
  CheckCircle2,
  XCircle,
  Pencil,
  Download,
  X,
  DollarSign
} from "lucide-react";

export interface AppointmentSummary {
  id: number;
  date: string;
  time: string;
  description?: string;
  status: "scheduled" | "cancelled" | "modified" | "pending";
}

export interface CostBreakdown {
  beyondPresenceMinutes: number;
  beyondPresenceCost: number;
  openAiSummaryCost: number;
  totalCost: number;
}

export interface CallSummaryData {
  sessionId: number;
  duration: string;
  durationSeconds?: number;
  userName?: string;
  phoneNumber?: string;
  summary: string;
  appointments: AppointmentSummary[];
  userPreferences?: string[];
  timestamp: Date;
  costBreakdown?: CostBreakdown;
}

interface CallSummaryProps {
  data: CallSummaryData;
  onClose?: () => void;
  onNewCall?: () => void;
  className?: string;
}

export function CallSummary({ data, onClose, onNewCall, className }: CallSummaryProps) {
  const handleDownload = () => {
    const costSection = data.costBreakdown ? `
Cost Breakdown
--------------
Beyond Presence (${data.costBreakdown.beyondPresenceMinutes.toFixed(2)} min): $${data.costBreakdown.beyondPresenceCost.toFixed(4)}
OpenAI Summary: $${data.costBreakdown.openAiSummaryCost.toFixed(4)}
Total Cost: $${data.costBreakdown.totalCost.toFixed(4)}
` : "";

    const content = `
Call Summary
============
Date: ${data.timestamp.toLocaleString()}
Duration: ${data.duration}
${data.userName ? `User: ${data.userName}` : ""}
${data.phoneNumber ? `Phone: ${data.phoneNumber}` : ""}

Summary
-------
${data.summary}

${data.appointments.length > 0 ? `
Appointments
------------
${data.appointments.map(apt => `- ${apt.date} at ${apt.time}${apt.description ? `: ${apt.description}` : ""} (${apt.status})`).join("\n")}
` : ""}

${data.userPreferences && data.userPreferences.length > 0 ? `
User Preferences
----------------
${data.userPreferences.map(pref => `- ${pref}`).join("\n")}
` : ""}
${costSection}
    `.trim();

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-summary-${data.sessionId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4", className)}>
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>Call Summary</CardTitle>
              <p className="text-sm text-muted-foreground">
                {data.timestamp.toLocaleDateString()} at {data.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-summary">
              <X className="w-4 h-4" />
            </Button>
          )}
        </CardHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 pb-6">
            {/* Call Info */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Duration: <strong>{data.duration}</strong></span>
              </div>
              {data.userName && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">User: <strong>{data.userName}</strong></span>
                </div>
              )}
              {data.phoneNumber && (
                <div className="flex items-center gap-2 text-sm">
                  Phone: <strong>{data.phoneNumber}</strong>
                </div>
              )}
            </div>

            <Separator />

            {/* Summary */}
            <div>
              <h3 className="font-medium mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Conversation Summary
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {data.summary}
              </p>
            </div>

            {/* Appointments */}
            {data.appointments.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Appointments ({data.appointments.length})
                  </h3>
                  <div className="space-y-2">
                    {data.appointments.map((apt) => (
                      <div 
                        key={apt.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{apt.date}</span>
                            <span className="text-muted-foreground">at</span>
                            <span className="font-medium text-sm">{apt.time}</span>
                          </div>
                          {apt.description && (
                            <p className="text-xs text-muted-foreground mt-1">{apt.description}</p>
                          )}
                        </div>
                        <Badge 
                          variant="secondary"
                          className={cn(
                            apt.status === "scheduled" && "bg-green-500/10 text-green-500",
                            apt.status === "cancelled" && "bg-red-500/10 text-red-500",
                            apt.status === "modified" && "bg-yellow-500/10 text-yellow-500",
                            apt.status === "pending" && "bg-blue-500/10 text-blue-500"
                          )}
                        >
                          {apt.status === "scheduled" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {apt.status === "cancelled" && <XCircle className="w-3 h-3 mr-1" />}
                          {apt.status === "modified" && <Pencil className="w-3 h-3 mr-1" />}
                          {apt.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
                          {apt.status === "pending" ? "new" : apt.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* User Preferences */}
            {data.userPreferences && data.userPreferences.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-medium mb-2 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    User Preferences Noted
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {data.userPreferences.map((pref, i) => (
                      <Badge key={i} variant="secondary">{pref}</Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Cost Breakdown */}
            {data.costBreakdown && (
              <>
                <Separator />
                <div>
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Cost Breakdown (Estimated)
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">
                        Beyond Presence ({data.costBreakdown.beyondPresenceMinutes.toFixed(2)} min)
                      </span>
                      <span className="font-medium">${data.costBreakdown.beyondPresenceCost.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between items-center p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">OpenAI Summary</span>
                      <span className="font-medium">${data.costBreakdown.openAiSummaryCost.toFixed(4)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center p-2 rounded bg-primary/10">
                      <span className="font-medium">Total Cost</span>
                      <span className="font-bold text-primary">${data.costBreakdown.totalCost.toFixed(4)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    * Based on Beyond Presence: $0.50/min, OpenAI GPT-4o-mini: ~$0.001/call
                  </p>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t flex gap-3">
          <Button 
            variant="outline" 
            className="flex-1"
            onClick={handleDownload}
            data-testid="button-download-summary"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Summary
          </Button>
          {onNewCall && (
            <Button 
              className="flex-1"
              onClick={onNewCall}
              data-testid="button-new-call"
            >
              Start New Call
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
