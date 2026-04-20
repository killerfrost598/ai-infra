import { Badge } from "@/components/ui/badge";

type StatusConfig = {
  variant: "success" | "error" | "warning" | "secondary" | "outline";
  pulse?: boolean;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  NEW:          { variant: "secondary" },
  PROVISIONING: { variant: "warning",  pulse: true },
  READY:        { variant: "success" },
  FAILED:       { variant: "error" },
  TERMINATED:   { variant: "secondary" },
  PENDING:      { variant: "secondary" },
  DEPLOYING:    { variant: "warning",  pulse: true },
  RUNNING:      { variant: "success",  pulse: true },
  STOPPED:      { variant: "secondary" },
  SUCCESS:      { variant: "success" },
  PARTIAL:      { variant: "warning" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { variant: "secondary" as const };
  return (
    <Badge
      variant={config.variant}
      className={config.pulse ? "animate-pulse" : undefined}
    >
      {status}
    </Badge>
  );
}
