"use client";

import { CodeXml, Instagram } from "lucide-react";
import { useEffect, useRef } from "react";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL, REPOSITORY_URL } from "./app-footer";
import { LogoMark } from "./logo";
import { Kbd } from "@/components/studio/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import { VOICE_LANGUAGES } from "@/lib/voices/catalog";

export type AboutSection = "privacy";

export function AboutDialog({ open, section, onOpenChange }: { open: boolean; section?: AboutSection; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const privacyRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open && section === "privacy") {
      const id = requestAnimationFrame(() => privacyRef.current?.scrollIntoView({ block: "start" }));
      return () => cancelAnimationFrame(id);
    }
  }, [open, section]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={t("about.close")}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <div>
              <DialogTitle>{t("about.title")}</DialogTitle>
              <p className="text-muted-foreground text-sm">
                Listen to me · <span lang="ar">اسمعني</span>
              </p>
            </div>
          </div>
          <DialogDescription className="pt-2 leading-relaxed">{t("about.intro", { languages: VOICE_LANGUAGES.length })}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3">
          <div>
            <p className="text-muted-foreground text-[13px]">{t("about.creator")}</p>
            <p className="font-medium" dir="ltr">Yousif AL_Shamri</p>
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              <Instagram className="size-4" aria-hidden />
              <span>{t("about.instagram")}</span>
              <span dir="ltr">@{INSTAGRAM_HANDLE}</span>
            </a>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
            >
              <CodeXml className="size-4" aria-hidden />
              <span>{t("about.source")}</span>
            </a>
          </div>
        </div>

        <section aria-labelledby="about-privacy" className="space-y-2">
          <h3 id="about-privacy" ref={privacyRef} className="scroll-mt-4 font-semibold">
            {t("about.privacyTitle")}
          </h3>
          <ul className="text-muted-foreground list-disc space-y-1.5 ps-5 text-sm leading-relaxed">
            <li>{t("about.privacy1")}</li>
            <li>{t("about.privacy2")}</li>
            <li>{t("about.privacy3")}</li>
            <li>{t("about.privacy4")}</li>
          </ul>
        </section>

        <section aria-labelledby="about-limits" className="space-y-2">
          <h3 id="about-limits" className="font-semibold">{t("about.limitsTitle")}</h3>
          <ul className="text-muted-foreground list-disc space-y-1.5 ps-5 text-sm leading-relaxed">
            <li>{t("about.limits1")}</li>
            <li>{t("about.limits2")}</li>
            <li>{t("about.limits3")}</li>
            <li>{t("about.limits4")}</li>
          </ul>
        </section>

        <section aria-labelledby="about-keys" className="space-y-2">
          <h3 id="about-keys" className="font-semibold">{t("about.shortcutsTitle")}</h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            <dt><Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd></dt>
            <dd className="text-muted-foreground">{t("about.shortcutGenerate")}</dd>
            <dt><Kbd>↑</Kbd> <Kbd>↓</Kbd></dt>
            <dd className="text-muted-foreground">{t("about.shortcutList")}</dd>
          </dl>
        </section>
      </DialogContent>
    </Dialog>
  );
}
