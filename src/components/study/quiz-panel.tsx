"use client";

import { CheckCircle2, Crosshair, Download, Play, RotateCcw, Timer, XCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useNow, useQuizResults } from "./study-hooks";
import { useWorkspace } from "./workspace-context";
import { Notice } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob } from "@/components/library/library-hooks";
import { useI18n } from "@/lib/i18n/provider";
import type { Definition } from "@/lib/study/definitions";
import { quizMarkdown } from "@/lib/study/export";
import { KINDS_BY_DIFFICULTY, isCorrect, makeQuiz, score, type Answer, type Difficulty, type Question } from "@/lib/study/quiz";
import { saveQuizResult } from "@/lib/study/store";
import { cn } from "@/lib/utils";

type Mode = "practice" | "exam";
interface Settings {
  count: number;
  difficulty: Difficulty;
  from: number;
  to: number;
  mode: Mode;
}

type Stage =
  | { kind: "setup"; notEnough?: boolean }
  | { kind: "running"; key: number; questions: Question[]; answers: Record<string, Answer>; checked: string[]; startedAt: number; deadline: number | null; settings: Settings; fewer: boolean }
  | { kind: "results"; key: number; questions: Question[]; answers: Record<string, Answer>; durationMs: number; settings: Settings; timeUp: boolean };

const COUNTS = [5, 10, 15, 20, 30];
const LEVELS: Difficulty[] = ["easy", "medium", "hard"];
/** Exam time per question. */
const EXAM_SECONDS = 60;

type T = ReturnType<typeof useI18n>["t"];

function prompt(q: Question, t: T): string {
  switch (q.kind) {
    case "mcq-term":
      return t("study.quiz.whichTerm");
    case "mcq-definition":
      return t("study.quiz.whatIs", { term: q.term });
    case "true-false":
      return t("study.quiz.trueFalse");
    case "fill-blank":
      return t("study.quiz.fillBlank");
    case "matching":
      return t("study.quiz.matching");
  }
}

export function QuizSection({ definitions }: { definitions: Definition[] }) {
  const { t, fmt } = useI18n();
  const ws = useWorkspace();
  const id = useId();
  const { data: results } = useQuizResults(ws.doc.id);
  const [settings, setSettings] = useState<Settings>({ count: 10, difficulty: "medium", from: 1, to: ws.doc.pageCount, mode: "practice" });
  const [stage, setStage] = useState<Stage>({ kind: "setup" });

  function start(questions: Question[], s: Settings, fewer: boolean) {
    const now = Date.now();
    setStage({ kind: "running", key: now, questions, answers: {}, checked: [], startedAt: now, deadline: s.mode === "exam" ? now + questions.length * EXAM_SECONDS * 1000 : null, settings: s, fewer });
  }

  function begin() {
    const from = Math.max(1, Math.min(settings.from, settings.to));
    const to = Math.min(ws.doc.pageCount, Math.max(settings.from, settings.to));
    const pool = definitions.filter((d) => d.page >= from && d.page <= to);
    const questions = makeQuiz(pool, { count: settings.count, kinds: KINDS_BY_DIFFICULTY[settings.difficulty], seed: Date.now() });
    if (!questions.length) return setStage({ kind: "setup", notEnough: true });
    start(questions, settings, questions.length < settings.count);
  }

  function finish(timeUp = false) {
    if (stage.kind !== "running") return;
    const { questions, answers, settings: s, startedAt } = stage;
    const durationMs = Date.now() - startedAt;
    const result = score(questions, answers);
    setStage({ kind: "results", key: stage.key, questions, answers, durationMs, settings: s, timeUp });
    void saveQuizResult({ docId: ws.doc.id, difficulty: s.difficulty, mode: s.mode, ...result, durationMs, questions, answers }).catch(() => toast.error(t("library.errors.FAILED")));
  }

  function exportQuiz(questions: Question[]) {
    const md = quizMarkdown(ws.doc.title, questions, { page: (n) => t("study.pageLabel", { n }), prompt: (q) => prompt(q, t), yes: t("study.quiz.yes"), no: t("study.quiz.no"), answerKey: t("study.quiz.answerKey") });
    downloadBlob(new Blob([String.fromCharCode(0xfeff) + md], { type: "text/markdown;charset=utf-8" }), `${ws.doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "lecture"}_quiz.md`);
  }

  if (stage.kind === "running") {
    const { questions, answers, checked } = stage;
    const exam = stage.settings.mode === "exam";
    return (
      <section aria-labelledby={`${id}-title`} className="space-y-3">
        <div className="bg-background sticky -top-4 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            {t(`study.quiz.levels.${stage.settings.difficulty}`)} · {t(`study.quiz.modeShort.${stage.settings.mode}`)}
          </h2>
          {stage.deadline !== null && <ExamTimer deadline={stage.deadline} onTimeUp={() => finish(true)} />}
          <Button size="sm" variant="ghost" onClick={() => setStage({ kind: "setup" })}>
            {t("study.quiz.exit")}
          </Button>
        </div>
        {stage.fewer && (
          <Notice tone="info">
            <p>{t("study.quiz.fewer", { count: questions.length })}</p>
          </Notice>
        )}
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <QuestionItem
              key={`${stage.key}-${q.id}`}
              name={`${stage.key}-${q.id}`}
              question={q}
              n={i + 1}
              total={questions.length}
              answer={answers[q.id] ?? null}
              state={checked.includes(q.id) ? "checked" : "open"}
              onAnswer={(a) => setStage({ ...stage, answers: { ...answers, [q.id]: a } })}
              onCheck={exam ? undefined : () => setStage({ ...stage, checked: [...checked, q.id] })}
            />
          ))}
        </ol>
        <Button onClick={() => finish()}>{t("study.quiz.submit")}</Button>
      </section>
    );
  }

  if (stage.kind === "results") {
    const { questions, answers } = stage;
    const s = score(questions, answers);
    const wrong = questions.filter((q) => !isCorrect(q, answers[q.id] ?? null));
    return (
      <section aria-labelledby={`${id}-title`} className="space-y-3">
        {stage.timeUp && (
          <Notice tone="warning" role="alert">
            <p>{t("study.quiz.timeUp")}</p>
          </Notice>
        )}
        <div className="bg-primary-soft rounded-lg p-3" role="status">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            {t("study.quiz.score", { correct: s.correct, total: s.total, percent: s.percent })}
          </h2>
          <p className="text-muted-foreground text-[13px]">{t("study.quiz.took", { time: fmt.duration(stage.durationMs / 1000) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {wrong.length > 0 && (
            <Button size="sm" onClick={() => start(wrong, stage.settings, false)}>
              <RotateCcw aria-hidden />
              {t("study.quiz.retakeWrong")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setStage({ kind: "setup" })}>
            <Play aria-hidden />
            {t("study.quiz.again")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exportQuiz(questions)}>
            <Download aria-hidden />
            {t("study.quiz.exportQuiz")}
          </Button>
        </div>
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <QuestionItem key={`${stage.key}-${q.id}`} name={`r${stage.key}-${q.id}`} question={q} n={i + 1} total={questions.length} answer={answers[q.id] ?? null} state="review" />
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <h2 id={`${id}-title`} className="sr-only">
        {t("study.practice.sections.quiz")}
      </h2>
      <form
        className="space-y-3 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          begin();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={`${id}-count`} className="text-[13px] font-medium">
              {t("study.quiz.count")}
            </label>
            <select id={`${id}-count`} value={settings.count} onChange={(e) => setSettings({ ...settings, count: Number(e.target.value) })} className="border-input bg-background mt-1 h-9 w-full rounded-lg border px-2 text-sm">
              {COUNTS.map((c) => (
                <option key={c} value={c}>
                  {fmt.number(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-from`} className="text-[13px] font-medium">
              {t("study.quiz.fromPage")}
            </label>
            <Input id={`${id}-from`} type="number" min={1} max={ws.doc.pageCount} value={settings.from} onChange={(e) => setSettings({ ...settings, from: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 h-9" />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className="text-[13px] font-medium">
              {t("study.quiz.toPage")}
            </label>
            <Input id={`${id}-to`} type="number" min={1} max={ws.doc.pageCount} value={settings.to} onChange={(e) => setSettings({ ...settings, to: Math.min(ws.doc.pageCount, Number(e.target.value) || ws.doc.pageCount) })} className="mt-1 h-9" />
          </div>
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium">{t("study.quiz.difficulty")}</legend>
          <div className="mt-0.5">
            {LEVELS.map((level) => (
              <label key={level} className="flex items-start gap-2 py-1 text-[13px]">
                <input type="radio" name={`${id}-level`} className="accent-primary mt-0.5 size-4" checked={settings.difficulty === level} onChange={() => setSettings({ ...settings, difficulty: level })} />
                <span>
                  <span className="font-medium">{t(`study.quiz.levels.${level}`)}</span> <span className="text-muted-foreground">· {t(`study.quiz.levelHints.${level}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-medium">{t("study.quiz.mode")}</legend>
          <div className="mt-0.5">
            {(["practice", "exam"] as const).map((mode) => (
              <label key={mode} className="flex items-start gap-2 py-1 text-[13px]">
                <input type="radio" name={`${id}-mode`} className="accent-primary mt-0.5 size-4" checked={settings.mode === mode} onChange={() => setSettings({ ...settings, mode })} />
                {t(`study.quiz.modes.${mode}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {stage.notEnough && (
          <Notice tone="warning" role="alert">
            <p>{t("study.quiz.notEnough")}</p>
          </Notice>
        )}
        <Button type="submit" size="sm" disabled={definitions.length === 0}>
          <Play aria-hidden />
          {t("study.quiz.start")}
        </Button>
      </form>
      {definitions.length === 0 && (
        <Notice tone="info">
          <p>{t("study.practice.noDefinitions")}</p>
        </Notice>
      )}
      {results && results.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-semibold">{t("study.quiz.history")}</h3>
          <ul className="divide-y rounded-lg border text-[13px]">
            {results.slice(0, 10).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                <span>
                  {t("study.quiz.result", {
                    score: t("study.quiz.score", { correct: r.correct, total: r.total, percent: r.percent }),
                    level: t(`study.quiz.levels.${r.difficulty}`),
                    mode: t(`study.quiz.modeShort.${r.mode}`),
                  })}
                </span>
                <span className="text-muted-foreground">{fmt.date(new Date(r.createdAt))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ExamTimer({ deadline, onTimeUp }: { deadline: number; onTimeUp: () => void }) {
  const { t, fmt } = useI18n();
  const now = useNow(1000);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const fired = useRef(false);
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    onTimeUp();
  }, [left, onTimeUp]);
  return (
    <p className={cn("flex items-center gap-1.5 text-[13px] font-semibold tabular-nums", left <= 30 && "text-destructive")}>
      <Timer className="size-4" aria-hidden />
      {t("study.quiz.timeLeft", { time: fmt.clock(left) })}
    </p>
  );
}

function QuestionItem({
  question: q,
  name,
  n,
  total,
  answer,
  state,
  onAnswer,
  onCheck,
}: {
  question: Question;
  name: string;
  n: number;
  total: number;
  answer: Answer;
  state: "open" | "checked" | "review";
  onAnswer?: (a: Answer) => void;
  onCheck?: () => void;
}) {
  const { t } = useI18n();
  const ws = useWorkspace();
  const locked = state !== "open";
  const correct = isCorrect(q, answer);
  const set = (a: Answer) => !locked && onAnswer?.(a);

  const radio = (value: string | boolean, label: string) => (
    <label key={String(value)} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5", !locked && "hover:bg-accent", locked && value === q.answer && "bg-primary-soft font-medium")}>
      <input type="radio" name={name} className="accent-primary mt-1 size-4 shrink-0" checked={answer === value} disabled={locked} onChange={() => set(value)} />
      <span dir="auto">{label}</span>
    </label>
  );

  let body: React.ReactNode;
  if (q.kind === "mcq-term" || q.kind === "mcq-definition") {
    body = (
      <>
        {q.kind === "mcq-term" && (
          <p dir="auto" className="bg-muted rounded-md px-2.5 py-1.5 leading-relaxed">
            {q.definition}
          </p>
        )}
        <div className="space-y-0.5">{q.options.map((o) => radio(o, o))}</div>
      </>
    );
  } else if (q.kind === "true-false") {
    body = (
      <>
        <p dir="auto" className="bg-muted rounded-md px-2.5 py-1.5 leading-relaxed">
          {t("study.quiz.statement", { term: q.term, definition: q.definition })}
        </p>
        <div className="flex gap-2">
          {radio(true, t("study.quiz.yes"))}
          {radio(false, t("study.quiz.no"))}
        </div>
      </>
    );
  } else if (q.kind === "fill-blank") {
    body = (
      <>
        <p dir="auto" className="bg-muted rounded-md px-2.5 py-1.5 leading-relaxed">
          {q.prompt}
        </p>
        <label className="block text-[13px] font-medium">
          {t("study.quiz.yourAnswer")}
          <Input dir="auto" value={typeof answer === "string" ? answer : ""} disabled={locked} maxLength={200} onChange={(e) => set(e.target.value)} className="mt-1 h-9" />
        </label>
      </>
    );
  } else {
    const chosen = (answer && typeof answer === "object" ? answer : {}) as Record<string, string>;
    body = (
      <div className="space-y-2">
        {q.terms.map((term) => (
          <label key={term} className="block text-[13px]">
            <span className="font-semibold" dir="auto">
              {term}
            </span>
            <select
              value={chosen[term] ?? ""}
              disabled={locked}
              onChange={(e) => set({ ...chosen, [term]: e.target.value })}
              className={cn("border-input bg-background mt-1 block h-auto min-h-9 w-full rounded-lg border px-2 py-1 text-sm", locked && chosen[term] === q.answer[term] && "border-success")}
            >
              <option value="">{t("study.quiz.choose")}</option>
              {q.definitions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  const correctAnswer =
    q.kind === "true-false"
      ? q.answer
        ? t("study.quiz.yes")
        : `${t("study.quiz.no")} · ${t("study.quiz.statement", { term: q.term, definition: q.correctDefinition })}`
      : q.kind === "matching"
        ? q.terms.map((term) => `${term} → ${q.answer[term]}`).join(" · ")
        : q.answer;

  return (
    <li className="rounded-lg border p-3">
      <fieldset className="space-y-2" style={{ fontSize: ws.textSize }}>
        <legend className="text-muted-foreground mb-1 text-[12px] font-medium">{t("study.quiz.number", { n, total })}</legend>
        <p className="font-semibold leading-relaxed" dir="auto">
          {prompt(q, t)}
        </p>
        {body}
      </fieldset>
      {state === "open" && onCheck && (
        <Button size="sm" variant="outline" className="mt-2" disabled={answer === null || answer === ""} onClick={onCheck}>
          {t("study.quiz.check")}
        </Button>
      )}
      {locked && (
        <div className="mt-2 space-y-1 border-t pt-2 text-[13px]">
          <p role="status" className={cn("flex items-center gap-1.5 font-semibold", correct ? "text-success" : "text-destructive")}>
            {correct ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {correct ? t("study.quiz.correct") : answer === null || answer === "" ? t("study.quiz.unanswered") : t("study.quiz.incorrect")}
          </p>
          {!correct && (
            <p dir="auto" className="leading-relaxed">
              {t("study.quiz.correctAnswer", { answer: correctAnswer })}
            </p>
          )}
          {q.kind === "matching" ? (
            <ul className="text-muted-foreground flex flex-wrap gap-x-3">
              {q.sources.map((s) => (
                <li key={s.term} dir="auto">
                  {s.term}: {t("study.pageLabel", { n: s.page })}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground leading-relaxed">
              <span>{t("study.quiz.source", { page: q.page })}</span>{" "}
              <q dir="auto">{q.source}</q>{" "}
              <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-[12px]" onClick={() => ws.focusParagraph(q.page, q.box)}>
                <Crosshair className="size-3.5" aria-hidden />
                {t("study.ask.showOnPage")}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
