import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Phone, 
  Calendar, 
  CalendarPlus, 
  CalendarX, 
  CalendarClock,
  Search,
  PhoneOff,
  CheckCircle,
  Loader2,
  AlertCircle
} from "lucide-react";

export interface ToolCallData {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
  result?: string;
  status: "pending" | "running" | "completed" | "error";
}

interface ToolCallDisplayProps {
  toolCalls: ToolCallData[];
  className?: string;
}

const toolIcons: Record<string, typeof Phone> = {
  identify_user: Phone,
  fetch_slots: Search,
  book_appointment: CalendarPlus,
  retrieve_appointments: Calendar,
  cancel_appointment: CalendarX,
  modify_appointment: CalendarClock,
  end_conversation: PhoneOff,
};

const toolLabels: Record<string, string> = {
  identify_user: "Identify User",
  fetch_slots: "Fetch Available Slots",
  book_appointment: "Book Appointment",
  retrieve_appointments: "Retrieve Appointments",
  cancel_appointment: "Cancel Appointment",
  modify_appointment: "Modify Appointment",
  end_conversation: "End Conversation",
};

const toolColors: Record<string, string> = {
  identify_user: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  fetch_slots: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  book_appointment: "bg-green-500/10 text-green-500 border-green-500/20",
  retrieve_appointments: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  cancel_appointment: "bg-red-500/10 text-red-500 border-red-500/20",
  modify_appointment: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  end_conversation: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export function ToolCallDisplay({ toolCalls, className }: ToolCallDisplayProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Tool Calls</h3>
      <div className="space-y-2">
        {toolCalls.map((tool) => {
          const Icon = toolIcons[tool.name] || Calendar;
          const label = toolLabels[tool.name] || tool.name;
          const colorClass = toolColors[tool.name] || "bg-muted text-muted-foreground";

          return (
            <Card 
              key={tool.id} 
              className={cn(
                "border transition-all duration-300",
                tool.status === "running" && "border-primary/50 shadow-sm shadow-primary/10"
              )}
            >
              <CardHeader className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <div className={cn("p-1.5 rounded-md border", colorClass)}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <CardTitle className="text-sm font-medium flex-1">{label}</CardTitle>
                  <div className="flex items-center gap-1">
                    {tool.status === "pending" && (
                      <Badge variant="secondary" className="text-xs">Pending</Badge>
                    )}
                    {tool.status === "running" && (
                      <Badge className="text-xs bg-primary/10 text-primary border-primary/20">
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Running
                      </Badge>
                    )}
                    {tool.status === "completed" && (
                      <Badge className="text-xs bg-green-500/10 text-green-500 border-green-500/20">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Done
                      </Badge>
                    )}
                    {tool.status === "error" && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Error
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              {(tool.parameters || tool.result) && (
                <CardContent className="py-2 px-3 pt-0">
                  {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                    <div className="text-xs text-muted-foreground mb-1">
                      <span className="font-medium">Params:</span>{" "}
                      {Object.entries(tool.parameters).map(([key, value]) => (
                        <span key={key} className="mr-2">
                          {key}: <span className="text-foreground">{String(value)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {tool.result && (
                    <div className="text-xs">
                      <span className="font-medium text-muted-foreground">Result:</span>{" "}
                      <span className="text-foreground">{tool.result}</span>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
