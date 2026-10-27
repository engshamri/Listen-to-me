"use client";

import { Check, Palette } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme } from "@/lib/theme/provider";
import { THEMES, type ThemeId } from "@/lib/theme/themes";
import { cn } from "@/lib/utils";

/**
 * A miniature of the real interface. Because tokens are scoped by
 * [data-theme], putting data-theme on this element renders the theme's actual
 * colors, so every card is a live preview.
 */
function Miniature({ id, className }: { id: ThemeId; className?: string }) {
  return (
    <div
      data-theme={id}
      aria-hidden
      className={cn("bg-background relative h-full overflow-hidden", className)}
      style={{ backgroundImage: "radial-gradient(ellipse 90% 70% at 50% -30%, var(--bg-glow), transparent 75%)" }}
    >
      <div className="bg-card border-border absolute inset-x-2.5 top-2.5 bottom-2.5 flex flex-col gap-1.5 rounded-md border p-2 shadow-card">
        <div className="bg-foreground h-1.5 w-1/2 rounded-full opacity-80" />
        <div className="bg-muted-foreground h-1.5 w-4/5 rounded-full opacity-60" />
        <div className="mt-auto flex items-center gap-1.5">
          <span className="bg-primary h-3 w-9 rounded-full" />
          <span className="bg-primary-soft h-3 w-6 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** triggerClassName / triggerLabel: the header's phone layout (a name under the icon). */
export function ThemeGallery({ triggerClassName, triggerLabel }: { triggerClassName?: string; triggerLabel?: ReactNode } = {}) {
  const { t } = useI18n();
  const { theme, setTheme, previewTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Also place focus on open from an effect: if the gallery is reopened while
  // its close animation is still running, Radix reuses the content and does
  // not run onOpenAutoFocus again.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const grid = gridRef.current;
      if (grid && !grid.contains(document.activeElement)) grid.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const groups: { label: string; items: (typeof THEMES)[number][] }[] = [
    { label: t("themes.groupAuto"), items: THEMES.filter((x) => x.scheme === "system") },
    { label: t("themes.groupLight"), items: THEMES.filter((x) => x.scheme === "light") },
    { label: t("themes.groupDark"), items: THEMES.filter((x) => x.scheme === "dark") },
  ];

  const schedulePreview = (id: ThemeId | null) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => previewTheme(id), id ? 140 : 0);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          clearTimeout(hoverTimer.current);
          previewTheme(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className={triggerClassName} aria-label={t("header.theme")}>
              <Palette aria-hidden />
              {triggerLabel}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("header.theme")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="scroll-thin max-h-[min(80dvh,40rem)] w-[min(94vw,36rem)] overflow-y-auto p-4"
        // Start on the current theme, so opening the gallery doesn't preview another one.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          gridRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
        }}
      >
        <h2 className="text-base font-semibold">{t("themes.title")}</h2>
        <p className="text-muted-foreground mt-0.5 mb-3 text-[13px]">{t("themes.hint")}</p>
        <div ref={gridRef} onPointerLeave={() => schedulePreview(null)} className="space-y-4">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="text-muted-foreground mb-2 text-[12px] font-semibold tracking-wide uppercase">{g.label}</h3>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {g.items.map((item) => {
                  const active = item.id === theme;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTheme(item.id)}
                      onPointerEnter={() => schedulePreview(item.id)}
                      onFocus={() => schedulePreview(item.id)}
                      className={cn(
                        "group overflow-hidden rounded-lg border text-start transition-shadow",
                        active ? "border-primary ring-primary ring-2" : "border-border hover:shadow-elevated",
                      )}
                    >
                      <div className="flex h-20">
                        {item.id === "system" ? (
                          <>
                            <Miniature id="light" className="w-1/2" />
                            <Miniature id="midnight" className="w-1/2" />
                          </>
                        ) : (
                          <Miniature id={item.id} className="w-full" />
                        )}
                      </div>
                      <div className="bg-popover text-popover-foreground flex items-center justify-between gap-1 border-t px-2.5 py-2 text-[13px] font-medium">
                        <span className="truncate">{t(`themes.${item.id}`)}</span>
                        {active && <Check className="text-primary size-4 shrink-0" aria-hidden />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
