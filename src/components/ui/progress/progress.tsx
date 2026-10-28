"use client";

import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "@/lib/cn";

export function Progress({
  className,
  ...props
}: React.ComponentProps<typeof BaseProgress.Root>) {
  return (
    <BaseProgress.Root
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

export function ProgressTrack({
  className,
  ...props
}: React.ComponentProps<typeof BaseProgress.Track>) {
  return (
    <BaseProgress.Track
      className={cn(
        "h-2 w-full overflow-hidden rounded-sm bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function ProgressIndicator({
  className,
  ...props
}: React.ComponentProps<typeof BaseProgress.Indicator>) {
  return (
    <BaseProgress.Indicator
      className={cn(
        "h-full rounded-sm bg-accent transition-[width] duration-fast ease-out-quad",
        "data-[status=indeterminate]:w-1/3 data-[status=indeterminate]:animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

export function ProgressLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseProgress.Label>) {
  return (
    <BaseProgress.Label
      className={cn("text-sm font-medium text-fg", className)}
      {...props}
    />
  );
}

export function ProgressValue({
  className,
  ...props
}: React.ComponentProps<typeof BaseProgress.Value>) {
  return (
    <BaseProgress.Value
      className={cn("text-sm text-fg-muted", className)}
      {...props}
    />
  );
}
