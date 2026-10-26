"use client";

import { BookOpen, CheckCircle2, FilePlus2, FolderPlus, GraduationCap, MoreHorizontal, Pencil, ShieldCheck, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PROVIDERS } from "./consent";
import { useLectures, useStudySettings } from "./study-hooks";
import { useLectureImport } from "./use-lecture-import";
import { Notice, Panel, ProgressBar } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { createCourse, deleteCourse, deleteDoc, renameCourse, updateDoc, type Course, type StudyDoc } from "@/lib/study/store";
import { cn } from "@/lib/utils";

export function StudyHome() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, error } = useLectures();
  const { progress, importFile, cancel } = useLectureImport((doc) => router.push(`/study/${doc.id}`));
  const fileInput = useRef<HTMLInputElement>(null);
  const importCourse = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [newCourse, setNewCourse] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StudyDoc | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  const pick = (courseId: string | null) => {
    importCourse.current = courseId;
    fileInput.current?.click();
  };

  const docs = data?.docs ?? [];
  const courses = data?.courses ?? [];
  const recent = docs.find((d) => d.lastOpenedAt !== null);
  const fail = (e: unknown) => toast.error(t((e as { code?: string })?.code === "QUOTA" ? "library.errors.QUOTA" : "library.errors.FAILED"));

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-10 outline-none sm:px-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-[28px]">
          <GraduationCap className="text-primary size-7" aria-hidden />
          {t("study.title")}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-[15px] leading-relaxed">{t("study.intro")}</p>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file, importCourse.current);
        }}
      />

      <Panel
        aria-label={t("study.open")}
        className={cn("mb-6 border-dashed p-5 text-center transition-colors", dragging && "border-primary bg-primary-soft")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void importFile(file, null);
        }}
      >
        {progress ? (
          <div className="mx-auto max-w-md space-y-3" role="status" aria-live="polite">
            <p className="text-sm font-medium">{progress.total ? t("study.reading", { done: progress.done, total: progress.total }) : t("pdf.opening")}</p>
            <ProgressBar value={progress.total ? (progress.done / progress.total) * 100 : null} label={t("study.open")} />
            <Button variant="outline" size="sm" onClick={cancel}>
              {t("study.cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" onClick={() => pick(null)}>
              <Upload aria-hidden />
              {t("study.open")}
            </Button>
            <p className="text-muted-foreground text-[13px]">{t("study.dropHint")}</p>
          </div>
        )}
      </Panel>

      {error ? (
        <Notice tone="error" role="alert">
          <p>{t((error as { code?: string })?.code === "UNAVAILABLE" ? "library.errors.UNAVAILABLE" : "library.errors.FAILED")}</p>
        </Notice>
      ) : null}

      {recent && (
        <Panel aria-labelledby="continue-study" className="mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <BookOpen className="text-primary hidden size-8 shrink-0 sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="continue-study" className="text-muted-foreground text-[13px] font-medium">
              {t("study.continue")}
            </h2>
            <p className="truncate font-semibold" dir="auto">
              {recent.title}
            </p>
            <p className="text-muted-foreground text-[13px]">{t("study.pageOf", { page: recent.lastPage, total: recent.pageCount })}</p>
          </div>
          <Button asChild>
            <Link href={`/study/${recent.id}`}>{t("study.continue")}</Link>
          </Button>
        </Panel>
      )}

      <section aria-labelledby="courses-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="courses-title" className="text-lg font-semibold">
            {t("study.courses")}
          </h2>
          {newCourse === null ? (
            <Button variant="outline" size="sm" onClick={() => setNewCourse("")}>
              <FolderPlus aria-hidden />
              {t("study.newCourse")}
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newCourse.trim()) void createCourse(newCourse).catch(fail);
                setNewCourse(null);
              }}
            >
              <label htmlFor="new-course" className="sr-only">
                {t("study.courseName")}
              </label>
              <Input id="new-course" autoFocus dir="auto" value={newCourse} maxLength={120} placeholder={t("study.courseName")} onChange={(e) => setNewCourse(e.target.value)} className="h-8 w-56" />
              <Button type="submit" size="sm">
                {t("study.create")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewCourse(null)}>
                {t("study.cancel")}
              </Button>
            </form>
          )}
        </div>

        {data && !docs.length && !courses.length && <p className="text-muted-foreground py-6 text-center text-sm">{t("study.empty")}</p>}

        {courses.map((course) => (
          <CourseSection
            key={course.id}
            course={course}
            docs={docs.filter((d) => d.courseId === course.id)}
            courses={courses}
            onAdd={() => pick(course.id)}
            onDelete={() => setDeletingCourse(course)}
            onDeleteDoc={setDeleting}
          />
        ))}
        {docs.some((d) => !d.courseId) && <CourseSection course={null} docs={docs.filter((d) => !d.courseId)} courses={courses} onAdd={() => pick(null)} onDeleteDoc={setDeleting} />}
      </section>

      <PrivacySection />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("study.deleteTitle")}</DialogTitle>
            <DialogDescription dir="auto">{t("study.deleteBody", { title: deleting?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("study.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) void deleteDoc(deleting.id).catch(fail);
                setDeleting(null);
              }}
            >
              <Trash2 aria-hidden />
              {t("study.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingCourse !== null} onOpenChange={(open) => !open && setDeletingCourse(null)}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("study.deleteCourseTitle")}</DialogTitle>
            <DialogDescription dir="auto">{t("study.deleteCourseBody", { title: deletingCourse?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCourse(null)}>
              {t("study.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingCourse) void deleteCourse(deletingCourse.id).catch(fail);
                setDeletingCourse(null);
              }}
            >
              <Trash2 aria-hidden />
              {t("study.deleteCourse")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function CourseSection({
  course,
  docs,
  courses,
  onAdd,
  onDelete,
  onDeleteDoc,
}: {
  course: Course | null;
  docs: StudyDoc[];
  courses: Course[];
  onAdd: () => void;
  onDelete?: () => void;
  onDeleteDoc: (doc: StudyDoc) => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const headingId = useId();
  const title = course?.title ?? t("study.otherLectures");

  return (
    <Panel aria-labelledby={headingId} className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {renaming !== null && course ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void renameCourse(course.id, renaming);
              setRenaming(null);
            }}
          >
            <label htmlFor={`${headingId}-input`} className="sr-only">
              {t("study.courseName")}
            </label>
            <Input id={`${headingId}-input`} autoFocus dir="auto" value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} className="h-8 max-w-xs" />
            <Button type="submit" size="sm">
              {t("study.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
              {t("study.cancel")}
            </Button>
          </form>
        ) : (
          <h3 id={headingId} className="min-w-0 flex-1 truncate font-semibold" dir="auto">
            {title} <span className="text-muted-foreground text-[13px] font-normal">· {t("study.lectureCount", { count: docs.length })}</span>
          </h3>
        )}
        <Button size="sm" variant="outline" onClick={onAdd} aria-describedby={headingId}>
          <FilePlus2 aria-hidden />
          {t("study.open")}
        </Button>
        {course && (
          <>
            <Button size="icon-sm" variant="ghost" onClick={() => setRenaming(course.title)} aria-label={`${t("study.renameCourse")}: ${course.title}`}>
              <Pencil aria-hidden />
            </Button>
            <Button size="icon-sm" variant="destructive" onClick={onDelete} aria-label={`${t("study.deleteCourse")}: ${course.title}`}>
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
      {docs.length ? (
        <ul className="divide-y">
          {docs.map((doc) => (
            <LectureRow key={doc.id} doc={doc} courses={courses} onDelete={() => onDeleteDoc(doc)} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">{t("study.empty")}</p>
      )}
    </Panel>
  );
}

function LectureRow({ doc, courses, onDelete }: { doc: StudyDoc; courses: Course[]; onDelete: () => void }) {
  const { t, fmt } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const titleId = useId();
  const percent = doc.pageCount ? Math.round((doc.visited.length / doc.pageCount) * 100) : 0;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        {renaming !== null ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim()) void updateDoc(doc.id, { title: renaming.replace(/\s+/g, " ").trim() });
              setRenaming(null);
            }}
          >
            <label htmlFor={`${titleId}-input`} className="sr-only">
              {t("study.titleLabel")}
            </label>
            <Input id={`${titleId}-input`} autoFocus dir="auto" value={renaming} maxLength={200} onChange={(e) => setRenaming(e.target.value)} className="h-8" />
            <Button type="submit" size="sm">
              {t("study.save")}
            </Button>
          </form>
        ) : (
          <Link id={titleId} href={`/study/${doc.id}`} className="block truncate font-medium underline-offset-4 hover:underline" dir="auto">
            {doc.title}
          </Link>
        )}
        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]">
          <span>{t("study.pages", { count: doc.pageCount })}</span>
          <span aria-hidden>·</span>
          <span>{fmt.date(new Date(doc.createdAt))}</span>
          {doc.completed ? (
            <span className="text-success inline-flex items-center gap-1 font-medium">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {t("study.completed")}
            </span>
          ) : (
            <span>{t("study.progress", { percent })}</span>
          )}
        </p>
        {!doc.completed && percent > 0 && <ProgressBar value={percent} label={t("study.progress", { percent })} className="mt-1.5 h-1.5 max-w-xs" />}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`${t("study.lectureActions")}: ${doc.title}`} aria-describedby={titleId}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(doc.title)}>
            <Pencil aria-hidden />
            {t("study.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void updateDoc(doc.id, { completed: !doc.completed })}>
            <CheckCircle2 aria-hidden />
            {doc.completed ? t("study.markNotCompleted") : t("study.markCompleted")}
          </DropdownMenuItem>
          {courses.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("study.moveTo")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={doc.courseId ?? ""} onValueChange={(v) => void updateDoc(doc.id, { courseId: v || null })}>
                <DropdownMenuRadioItem value="">{t("study.noCourse")}</DropdownMenuRadioItem>
                {courses.map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={c.id} dir="auto">
                    {c.title}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            <Trash2 aria-hidden />
            {t("study.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PrivacySection() {
  const { t } = useI18n();
  const [settings, setSettings] = useStudySettings();
  const rows = [
    { label: t("study.privacyTranslate", { provider: PROVIDERS.translate }), allowed: settings.consentTranslate, withdraw: () => setSettings({ consentTranslate: false }) },
    { label: t("study.privacySpeech", { provider: PROVIDERS.speech }), allowed: settings.consentSpeech, withdraw: () => setSettings({ consentSpeech: false }) },
  ];
  return (
    <section aria-labelledby="study-privacy" className="mt-8">
      <h2 id="study-privacy" className="mb-2 flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="text-primary size-5" aria-hidden />
        {t("study.privacy")}
      </h2>
      <p className="text-muted-foreground mb-3 max-w-3xl text-[14px] leading-relaxed">{t("study.privacyIntro")}</p>
      <ul className="max-w-xl divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>{r.label}</span>
            <span className="flex items-center gap-2">
              <span className={r.allowed ? "text-success font-medium" : "text-muted-foreground"}>{r.allowed ? t("study.allowed") : t("study.notAllowed")}</span>
              {r.allowed && (
                <Button size="sm" variant="outline" onClick={r.withdraw}>
                  {t("study.withdraw")}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
