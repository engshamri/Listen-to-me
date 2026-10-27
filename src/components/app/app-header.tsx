"use client";

import { GraduationCap, HandHeart, Info, Languages, Library } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "./logo";
import { ThemeGallery } from "./theme-gallery";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LOCALE_LABEL, LOCALES, isLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Phones: every header control is its icon with a short name under it, as
 * wide as its name needs (at least 40 px) and 48 px tall; names are 10 px
 * below 360 px so "Language" fits a 320 px screen. From the sm breakpoint the desktop look
 * stays (names beside Study and My library, tooltips on the icon buttons).
 */
export const HEADER_ITEM =
  "max-sm:h-12 max-sm:min-w-10 max-sm:flex-auto max-sm:flex-col max-sm:gap-0.5 max-sm:px-0.5 max-sm:text-[11px] max-sm:leading-none max-sm:font-medium max-[359px]:text-[10px]";
/** The short name shown under the icon on phones only. */
export const PhoneLabel = ({ children }: { children: string }) => (
  <span className="whitespace-nowrap sm:hidden" aria-hidden>
    {children}
  </span>
);

export function AppHeader({ onAbout }: { onAbout: () => void }) {
  const { t, locale, setLocale } = useI18n();

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/90 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-md">
          <LogoMark className="size-7" />
          {/* On phones the six labelled tools need the width: the logo shows, the name stays for screen readers. */}
          <span className="truncate text-[15px] font-semibold tracking-tight max-sm:sr-only">{t("app.name")}</span>
          <span className="text-muted-foreground hidden truncate text-sm md:inline">· {t("app.tagline")}</span>
        </Link>

        <nav aria-label={t("header.tools")} className="ms-auto flex items-center gap-1 max-sm:flex-1 max-sm:gap-0.5 max-[359px]:gap-0">
          <Button asChild variant="ghost" size="sm" className={cn("gap-1.5", HEADER_ITEM)}>
            <Link href="/study" aria-label={t("study.nav")}>
              <GraduationCap aria-hidden />
              <span aria-hidden>{t("study.nav")}</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className={cn("gap-1.5", HEADER_ITEM)}>
            <Link href="/library" aria-label={t("header.library")}>
              <Library aria-hidden />
              <span className="hidden sm:inline" aria-hidden>
                {t("header.library")}
              </span>
              <PhoneLabel>{t("header.short.library")}</PhoneLabel>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("gap-1.5", HEADER_ITEM)} aria-label={`${t("header.short.language")}: ${LOCALE_LABEL[locale]}`}>
                <Languages aria-hidden />
                <span className="hidden sm:inline">{LOCALE_LABEL[locale]}</span>
                <PhoneLabel>{t("header.short.language")}</PhoneLabel>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("header.language")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
                {LOCALES.map((l) => (
                  <DropdownMenuRadioItem key={l} value={l} lang={l}>
                    {LOCALE_LABEL[l]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeGallery triggerClassName={HEADER_ITEM} triggerLabel={<PhoneLabel>{t("header.short.theme")}</PhoneLabel>} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm" className={HEADER_ITEM}>
                <Link href="/support" aria-label={t("header.support")}>
                  <HandHeart aria-hidden />
                  <PhoneLabel>{t("header.short.support")}</PhoneLabel>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.support")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className={HEADER_ITEM} onClick={onAbout} aria-label={t("header.about")}>
                <Info aria-hidden />
                <PhoneLabel>{t("header.short.about")}</PhoneLabel>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.about")}</TooltipContent>
          </Tooltip>
        </nav>
      </div>
    </header>
  );
}
