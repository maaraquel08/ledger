"use client";

import * as React from "react";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { cn } from "@/lib/cn";

export const Drawer = BaseDrawer.Root;
export const DrawerTrigger = BaseDrawer.Trigger;

// Bottom sheet: anchored to the bottom edge, dismissed via swipe-down by
// default (Drawer.Root's `swipeDirection` defaults to "down").
export function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseDrawer.Popup>) {
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop className="fixed inset-0 bg-black/40 transition-opacity duration-fast data-starting-style:opacity-0 data-ending-style:opacity-0" />
      {/* p-4 insets the sheet from the screen edges so it floats */}
      <BaseDrawer.Viewport className="fixed inset-0 flex items-end justify-center p-4">
        <BaseDrawer.Popup
          className={cn(
            "w-full max-w-lg rounded-xl border border-line bg-surface-raised p-6 text-fg shadow-overlay",
            "[transform:translateY(var(--drawer-swipe-movement-y))] transition-[transform,opacity] duration-fast ease-out-quad",
            // +1rem clears the viewport's bottom inset so the exit fully leaves the screen
            "motion-safe:data-starting-style:[transform:translateY(calc(100%+1rem))] motion-safe:data-ending-style:[transform:translateY(calc(100%+1rem))]",
            "motion-reduce:data-starting-style:opacity-0 motion-reduce:data-ending-style:opacity-0",
            className,
          )}
          {...props}
        >
          <div
            aria-hidden
            className="mx-auto mb-4 h-1.5 w-10 shrink-0 rounded-full bg-line-strong"
          />
          <BaseDrawer.Content className="mx-auto w-full">
            {children}
          </BaseDrawer.Content>
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
}

export const DrawerTitle = BaseDrawer.Title;
export const DrawerDescription = BaseDrawer.Description;
export const DrawerClose = BaseDrawer.Close;
