"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AboutDialog, type AboutSection } from "./about-dialog";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { useI18n } from "@/lib/i18n/provider";

interface ShellContextValue {
  openAbout: (section?: AboutSection) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside AppShell");
  return ctx;
}

export function AppShell({ year, children }: { year: number; children: ReactNode }) {
  const { t } = useI18n();
  const [about, setAbout] = useState<{ open: boolean; section?: AboutSection }>({ open: false });
  const openAbout = useCallback((section?: AboutSection) => setAbout({ open: true, section }), []);
  const value = useMemo(() => ({ openAbout }), [openAbout]);

  return (
    <ShellContext.Provider value={value}>
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-[60] rounded-md px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {t("header.skip")}
      </a>
      <div className="flex min-h-dvh flex-col pb-[var(--generate-bar-h,0px)]">
        <AppHeader onAbout={() => openAbout()} />
        {children}
        <AppFooter year={year} onAbout={openAbout} />
      </div>
      <AboutDialog open={about.open} section={about.section} onOpenChange={(open) => setAbout((s) => ({ ...s, open }))} />
    </ShellContext.Provider>
  );
}
