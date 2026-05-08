import { cn } from "@/lib/utils"

interface SpinnerProps {
  size?: "sm" | "md"
  className?: string
}

export function Spinner({ size = "sm", className }: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-muted border-t-muted-foreground",
        size === "sm" ? "h-3 w-3" : "h-4 w-4",
        className
      )}
    />
  )
}
