"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { hasPreviousPage } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

/**
 * Back, at the top of secondary pages: returns to the previous page when it
 * was one of this app's pages in this tab, otherwise opens `fallback` (so a
 * page opened from a link or bookmark never sends the student out of the
 * app). A real link to `fallback`, so it also works before scripts load and
 * with "open in new tab".
 */
export function BackButton({ fallback = "/", className }: { fallback?: string; className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Button asChild variant="ghost" className={cn("-ms-2 mb-3 h-11 min-w-11 gap-1.5 px-2.5", className)}>
      <a
        href={fallback}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          if (hasPreviousPage()) router.back();
          else router.push(fallback);
        }}
      >
        <ArrowLeft className="rtl:-scale-x-100" aria-hidden />
        {t("header.back")}
      </a>
    </Button>
  );
}
