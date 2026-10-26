"use client";

import { HandHeart, Info, Languages, Library } from "lucide-react";
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

export function AppHeader({ onAbout }: { onAbout: () => void }) {
  const { t, locale, setLocale } = useI18n();

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/90 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-md">
          <LogoMark className="size-7" />
          <span className="truncate text-[15px] font-semibold tracking-tight">{t("app.name")}</span>
          <span className="text-muted-foreground hidden truncate text-sm md:inline">· {t("app.tagline")}</span>
        </Link>

        <div className="ms-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 max-sm:size-8 max-sm:px-0">
            <Link href="/library" aria-label={t("header.library")}>
              <Library aria-hidden />
              <span className="hidden sm:inline" aria-hidden>
                {t("header.library")}
              </span>
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5" aria-label={`${t("header.language")}: ${LOCALE_LABEL[locale]}`}>
                <Languages aria-hidden />
                <span className="hidden sm:inline">{LOCALE_LABEL[locale]}</span>
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

          <ThemeGallery />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <Link href="/support" aria-label={t("header.support")}>
                  <HandHeart aria-hidden />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.support")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onAbout} aria-label={t("header.about")}>
                <Info aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.about")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
