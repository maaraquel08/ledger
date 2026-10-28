"use client";

import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@/lib/cn";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "relative flex h-6 w-10 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-fast ease-out-quad",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "data-checked:bg-accent",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="aspect-square h-full rounded-full bg-surface-raised shadow-raised transition-transform duration-fast ease-out-quad data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );
}
