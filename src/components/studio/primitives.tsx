"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card wrapper used by every studio section. */
export function Panel({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("bg-card text-card-foreground rounded-xl border shadow-card", className)} {...props}>
      {children}
    </section>
  );
}

/** Numbered section heading: the numbers mirror the task order (text → voice → settings). */
export function StepHeading({ step, id, children, aside }: { step?: number; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold">
        {step !== undefined && (
          <span aria-hidden className="bg-primary-soft text-primary-soft-foreground flex size-6 items-center justify-center rounded-full text-[13px] font-semibold">
            {step}
          </span>
        )}
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** Determinate or indeterminate progress bar; fills from the inline start (correct in RTL). */
export function ProgressBar({ value, label, valueText, className }: { value: number | null; label: string; valueText?: string; className?: string }) {
  const determinate = value !== null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(value) : undefined}
      aria-valuetext={valueText}
      className={cn("bg-muted relative h-2 w-full overflow-hidden rounded-full", className)}
    >
      {determinate ? (
        <div className="bg-primary h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      ) : (
        <div className="bg-primary progress-indeterminate absolute inset-y-0 w-1/3 rounded-full" />
      )}
    </div>
  );
}

export function Flag({ country, className }: { country: string; className?: string }) {
  if (!country) return <span aria-hidden className={cn("bg-muted inline-block h-[15px] w-5 shrink-0 rounded-[3px]", className)} />;
  return (
    <img
      src={`/flags/${country.toLowerCase()}.svg`}
      alt=""
      width={20}
      height={15}
      loading="lazy"
      decoding="async"
      className={cn("h-[15px] w-5 shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_rgb(0_0_0/0.12)]", className)}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd dir="ltr" className="bg-muted text-foreground rounded border px-1.5 py-px font-sans text-[12px] font-medium">
      {children}
    </kbd>
  );
}

/** Inline notice for warnings and errors that must stay visible (unlike toasts). */
export function Notice({ tone = "warning", children, className, role }: { tone?: "warning" | "error" | "info"; children: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-lg border px-3.5 py-3 text-sm leading-relaxed",
        tone === "warning" && "bg-warning-soft text-warning-foreground border-transparent",
        tone === "error" && "bg-destructive-soft text-destructive border-transparent",
        tone === "info" && "bg-muted text-muted-foreground border-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}
