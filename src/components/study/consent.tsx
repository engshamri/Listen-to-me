"use client";

import { ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { getStudySettings, setStudySettings } from "./study-hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";

/*
 * Lecture text leaves the device only after the student allows it, once per
 * service (translation, speech). The choice is kept in this browser and can
 * be withdrawn on the Study page.
 */

export type ConsentKind = "translate" | "speech";

export const PROVIDERS: Record<ConsentKind, string> = { translate: "Google Translate", speech: "Microsoft" };

const ConsentContext = createContext<((kind: ConsentKind) => Promise<boolean>) | null>(null);

export function useConsent() {
  const ask = useContext(ConsentContext);
  if (!ask) throw new Error("useConsent must be used inside ConsentProvider");
  return ask;
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<ConsentKind | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((kind: ConsentKind) => {
    const s = getStudySettings();
    if (kind === "translate" ? s.consentTranslate : s.consentSpeech) return Promise.resolve(true);
    resolver.current?.(false);
    setPending(kind);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (ok: boolean) => {
    if (ok && pending) setStudySettings(pending === "translate" ? { consentTranslate: true } : { consentSpeech: true });
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  const provider = pending ? PROVIDERS[pending] : "";
  const value = useMemo(() => ask, [ask]);
  return (
    <ConsentContext.Provider value={value}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && answer(false)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="text-primary size-5" aria-hidden />
              {t("study.consentTitle", { provider })}
            </DialogTitle>
            <DialogDescription>{pending === "speech" ? t("study.consentSpeech", { provider }) : t("study.consentTranslate", { provider })}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-[13px]">{t("study.consentNote")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => answer(false)}>
              {t("study.consentCancel")}
            </Button>
            <Button onClick={() => answer(true)}>{t("study.consentAllow")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConsentContext.Provider>
  );
}
