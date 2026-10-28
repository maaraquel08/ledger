import { cn } from "@/lib/cn";

/** Yellow corner brackets over the viewfinder. */
export function ReceiptFrame({ className, corner = 30 }: { className?: string; corner?: number }) {
  const c = "absolute border-highlight";
  const size = { width: corner, height: corner };
  return (
    <div aria-hidden className={cn("pointer-events-none relative h-[62%] w-[66%]", className)}>
      <span style={size} className={cn(c, "top-0 left-0 rounded-tl-[6px] border-t-[3px] border-l-[3px]")} />
      <span style={size} className={cn(c, "top-0 right-0 rounded-tr-[6px] border-t-[3px] border-r-[3px]")} />
      <span style={size} className={cn(c, "bottom-0 left-0 rounded-bl-[6px] border-b-[3px] border-l-[3px]")} />
      <span style={size} className={cn(c, "right-0 bottom-0 rounded-br-[6px] border-r-[3px] border-b-[3px]")} />
    </div>
  );
}
