"use client";

import { DatabaseBackup, Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/components/library/library-hooks";
import { useI18n } from "@/lib/i18n/provider";
import { BackupError, createBackup, restoreBackup } from "@/lib/study/backup";

/** Download everything in Study as one file, or restore such a file. */
export function BackupSection() {
  const { t } = useI18n();
  const [withPdfs, setWithPdfs] = useState(true);
  const [busy, setBusy] = useState<"create" | "restore" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function download() {
    setBusy("create");
    try {
      const file = await createBackup({ withFiles: withPdfs });
      downloadBlob(file, `listen-to-me-study-backup-${new Date().toISOString().slice(0, 10)}.json`);
    } catch {
      toast.error(t("library.errors.FAILED"));
    } finally {
      setBusy(null);
    }
  }

  async function restore(file: File) {
    setBusy("restore");
    try {
      const summary = await restoreBackup(file);
      toast.success(t("study.backup.restored", { lectures: summary.lectures, notes: summary.notes, cards: summary.cards, quizzes: summary.quizzes }));
      if (summary.missingPdfs.length) toast.warning(t("study.backup.missingPdfs", { count: summary.missingPdfs.length }), { duration: 10_000 });
    } catch (e) {
      if (e instanceof BackupError) toast.error(t(`study.backup.errors.${e.code}`));
      else toast.error(t((e as { code?: string })?.code === "QUOTA" ? "library.errors.QUOTA" : "library.errors.FAILED"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="study-backup" className="mt-8">
      <h2 id="study-backup" className="mb-2 flex items-center gap-2 text-lg font-semibold">
        <DatabaseBackup className="text-primary size-5" aria-hidden />
        {t("study.backup.title")}
      </h2>
      <p className="text-muted-foreground mb-3 max-w-3xl text-[14px] leading-relaxed">{t("study.backup.intro")}</p>
      <div className="flex max-w-3xl flex-col gap-3 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary size-4" checked={withPdfs} onChange={(e) => setWithPdfs(e.target.checked)} />
          {t("study.backup.withPdfs")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void download()}>
            {busy === "create" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            {busy === "create" ? t("study.backup.creating") : t("study.backup.create")}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void restore(file);
            }}
          />
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => input.current?.click()}>
            {busy === "restore" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {busy === "restore" ? t("study.backup.restoring") : t("study.backup.restore")}
          </Button>
        </div>
        <p className="text-muted-foreground text-[13px] leading-relaxed">{t("study.backup.restoreNote")}</p>
      </div>
    </section>
  );
}
