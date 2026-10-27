"use client";

import { ClipboardCopy, Stethoscope } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

/** Copy the diagnostic report of a PDF failure, or see it to copy by hand; and a link to the PDF check. */
export function DiagnosticActions({ report, showCheckLink = true }: { report: string; showCheckLink?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      toast.success(t("pdf.reportCopied"));
    } catch {
      // Clipboard refused (some in-app browsers): show the report to select by hand.
      setOpen(true);
      toast.info(t("pdf.reportCopyManual"));
    }
  }

  return (
    <div className="mt-2 space-y-2" data-testid="pdf-diagnostics">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <ClipboardCopy aria-hidden />
          {t("pdf.copyReport")}
        </Button>
        {showCheckLink && (
          <Button asChild size="sm" variant="ghost">
            <a href="/pdf-check" target="_blank" rel="noopener">
              <Stethoscope aria-hidden />
              {t("pdf.runCheck")}
            </a>
          </Button>
        )}
      </div>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="text-[13px]">
        <summary className="text-muted-foreground cursor-pointer">{t("pdf.showReport")}</summary>
        <p className="text-muted-foreground mt-1">{t("pdf.reportNote")}</p>
        <textarea
          readOnly
          value={report}
          rows={8}
          dir="ltr"
          aria-label={t("pdf.reportLabel")}
          onFocus={(e) => e.currentTarget.select()}
          className="border-input bg-card mt-1 w-full rounded-md border p-2 font-mono text-[12px] leading-snug"
        />
      </details>
    </div>
  );
}
