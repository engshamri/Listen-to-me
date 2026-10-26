"use client";

import { CodeXml, HandHeart, Instagram, Library } from "lucide-react";
import Link from "next/link";
import type { AboutSection } from "./about-dialog";
import { useI18n } from "@/lib/i18n/provider";

export const INSTAGRAM_HANDLE = "mmmmn";
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;
export const REPOSITORY_URL = "https://github.com/engshamri/Listen_to_me";

export function AppFooter({ year, onAbout }: { year: number; onAbout: (section?: AboutSection) => void }) {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-6 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t("footer.rights", { year: String(year) })}</p>
        <nav aria-label={t("footer.about")} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className="hover:text-foreground underline-offset-4 hover:underline" onClick={() => onAbout()}>
            {t("footer.about")}
          </button>
          <button type="button" className="hover:text-foreground underline-offset-4 hover:underline" onClick={() => onAbout("privacy")}>
            {t("footer.privacy")}
          </button>
          <Link href="/library" className="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
            <Library className="size-4" aria-hidden />
            {t("footer.library")}
          </Link>
          <Link href="/support" className="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
            <HandHeart className="size-4" aria-hidden />
            {t("footer.support")}
          </Link>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
          >
            <Instagram className="size-4" aria-hidden />
            <span dir="ltr">@{INSTAGRAM_HANDLE}</span>
          </a>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
          >
            <CodeXml className="size-4" aria-hidden />
            {t("footer.source")}
          </a>
        </nav>
      </div>
      <p className="text-muted-foreground mx-auto w-full max-w-7xl px-4 pb-6 text-[13px] sm:px-6">{t("footer.credits")}</p>
    </footer>
  );
}
