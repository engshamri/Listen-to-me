import { cn } from "@/lib/utils";

/** Brand mark: a rounded tile with a short waveform, drawn in theme colors. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <g fill="var(--primary-foreground)">
        <rect x="7.5" y="13" width="2.8" height="6" rx="1.4" />
        <rect x="12.3" y="8.5" width="2.8" height="15" rx="1.4" />
        <rect x="17.1" y="11" width="2.8" height="10" rx="1.4" />
        <rect x="21.9" y="14" width="2.8" height="4" rx="1.4" />
      </g>
    </svg>
  );
}
