"use client";

import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@/lib/cn";

export const Tabs = BaseTabs.Root;

export function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn("relative flex gap-1 rounded-lg bg-surface p-1", className)}
      {...props}
    >
      {children}
      <BaseTabs.Indicator className="absolute top-1 left-0 z-0 h-[calc(100%-0.5rem)] w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-surface-raised shadow-raised transition-[translate,width] duration-fast ease-out-quad motion-reduce:transition-none" />
    </BaseTabs.List>
  );
}

export function TabsTab({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "z-1 flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize text-fg-muted transition-colors duration-fast ease-out-quad data-active:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel
      className={cn("p-4 text-sm text-fg-muted", className)}
      {...props}
    />
  );
}
