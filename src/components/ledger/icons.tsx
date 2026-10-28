import * as React from "react";

type P = React.SVGProps<SVGSVGElement> & { size?: number };

const stroke = (size = 20, props: P) => ({
  viewBox: "0 0 24 24",
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const HomeIcon = ({ size, filled, ...p }: P & { filled?: boolean }) =>
  filled ? (
    <svg viewBox="0 0 24 24" width={size ?? 20} height={size ?? 20} fill="currentColor" aria-hidden {...p}>
      <path d="M3.6 10.4 12 3.6l8.4 6.8V20a1 1 0 0 1-1 1h-5v-6h-4.8v6h-5a1 1 0 0 1-1-1z" />
    </svg>
  ) : (
    <svg {...stroke(size, p)}>
      <path d="M3.8 10.6 12 4l8.2 6.6V19.8a1 1 0 0 1-1 1h-4.6v-6.2H9.4v6.2H4.8a1 1 0 0 1-1-1z" />
    </svg>
  );

export const AccountsIcon = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...stroke(size, p)}>
    <path
      fill={filled ? "currentColor" : "none"}
      d="M3.3 6.8A1.5 1.5 0 0 1 4.8 5.3h14.4a1.5 1.5 0 0 1 1.5 1.5v10.4a1.5 1.5 0 0 1-1.5 1.5H4.8a1.5 1.5 0 0 1-1.5-1.5z"
    />
    <path d="M3.3 9.9h17.4v1.6H3.3z" fill={filled ? "var(--color-bg)" : "none"} stroke={filled ? "var(--color-bg)" : "currentColor"} />
  </svg>
);

/** Review: an in-tray. */
export const ReviewIcon = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...stroke(size, p)}>
    <path
      fill={filled ? "currentColor" : "none"}
      d="M3.8 13.4 6.1 5.8a1.5 1.5 0 0 1 1.4-1.1h9a1.5 1.5 0 0 1 1.4 1.1l2.3 7.6v5.3a1.5 1.5 0 0 1-1.5 1.5H5.3a1.5 1.5 0 0 1-1.5-1.5z"
    />
    <path d="M3.8 13.4h4.6l1.3 2.4h4.6l1.3-2.4h4.6" stroke={filled ? "var(--color-bg)" : "currentColor"} />
  </svg>
);

/** Analytics: three bars on a baseline. */
export const AnalyticsIcon = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...stroke(size, p)}>
    <path d="M3.8 20.2h16.4" />
    <path fill={filled ? "currentColor" : "none"} d="M5.6 12.6a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v7.6H5.6zM10.6 5.8a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v14.4h-3.8zM15.6 9.6a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v10.6h-3.8z" />
  </svg>
);

export const ChartIcon = ({ size = 17, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <polyline points="4 15.5 9 10.5 13 14 20 6.5" />
    <polyline points="15 6.5 20 6.5 20 11" />
  </svg>
);

export const CashIcon = ({ size = 17, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M6.5 12h.01M17.5 12h.01" />
  </svg>
);

export const SearchIcon = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export const SortIcon = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />
  </svg>
);

export const ChevronLeft = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </svg>
);

export const ChevronRight = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </svg>
);

export const CloseIcon = ({ size = 14, ...p }: P) => (
  <svg {...stroke(size, p)} strokeWidth={1.8}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const PlusIcon = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)} strokeWidth={1.8}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowUpIcon = ({ size = 16, ...p }: P) => (
  <svg {...stroke(size, p)} strokeWidth={2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const MicIcon = ({ size = 18, ...p }: P) => (
  <svg {...stroke(size, p)}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </svg>
);

/** Scan a receipt: viewfinder corners with a read line. */
export const CheckIcon = ({ size = 16, ...p }: P) => (
  <svg {...stroke(size, p)} strokeWidth={2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const MoreIcon = ({ size = 18, ...p }: P) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...p}>
    <circle cx="5.5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18.5" cy="12" r="1.6" />
  </svg>
);

/** The four-point AI mark, in the brand's gold. */
export function Sparkle({ size = 13, className }: { size?: number; className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden style={{ flex: "none" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5c518" />
          <stop offset="1" stopColor="#d9a400" />
        </linearGradient>
      </defs>
      <path d="M12 1.5 L13.9 9.4 L21.8 11.3 L13.9 13.2 L12 21.1 L10.1 13.2 L2.2 11.3 L10.1 9.4 Z" fill={`url(#${id})`} />
    </svg>
  );
}
