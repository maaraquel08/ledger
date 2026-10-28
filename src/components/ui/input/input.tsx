"use client";

import * as React from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: React.ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      className={cn(
        "h-9 w-full rounded-md border border-line bg-surface-raised px-3 text-base text-fg sm:text-sm",
        "transition-colors duration-fast ease-out-quad",
        "placeholder:text-fg-subtle",
        "focus:outline-2 focus:outline-offset-2 focus:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
