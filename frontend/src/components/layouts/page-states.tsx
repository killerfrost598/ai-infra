import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface PageStateProps {
  className?: string
}

interface LoadingStateProps extends PageStateProps {
  text?: string
}

interface ErrorStateProps extends PageStateProps {
  message: string
}

interface EmptyStateProps extends PageStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function LoadingState({ text = "Loading…", className }: LoadingStateProps) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Spinner />
      {text}
    </div>
  )
}

export function ErrorState({ message, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive",
        className
      )}
    >
      {message}
    </div>
  )
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <Card className={cn("flex flex-col items-center gap-2 py-12 text-center", className)}>
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/60">{description}</p>}
      {action}
    </Card>
  )
}
