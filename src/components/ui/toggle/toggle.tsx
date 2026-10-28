"use client";

import * as React from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { cn } from "@/lib/cn";

export function Toggle({
  className,
  ...props
}: React.ComponentProps<typeof BaseToggle>) {
  return (
    <BaseToggle
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-fg transition-colors duration-fast ease-out-quad",
        "hover:bg-surface",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "data-pressed:bg-accent data-pressed:text-accent-fg",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
