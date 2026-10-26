"use client";

import { ArrowLeft, Bitcoin, Check, ChevronDown, Copy, Download, HandHeart, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Notice, Panel } from "@/components/studio/primitives";
import { Button } from "@/components/ui/button";
import { DONATION_METHODS, qrDownloadPath, qrImagePath, type DonationMethod, type DonationMethodId } from "@/lib/donations";
import { useI18n } from "@/lib/i18n/provider";
import type { TKey } from "@/lib/i18n/translate";

/** Message group in support.* for each method. */
const KEY: Record<DonationMethodId, "usdt" | "btc"> = { "usdt-trc20": "usdt", "btc-xlayer": "btc" };
const FAQ = [1, 2, 3, 4, 5] as const;

function CoinIcon({ id }: { id: DonationMethodId }) {
  if (id === "btc-xlayer") {
    return (
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f7931a] text-white">
        <Bitcoin className="size-6" strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="size-10 shrink-0">
      <circle cx="16" cy="16" r="16" fill="#26a17b" />
      <path fill="#fff" d="M9 8h14v3.4h-5.3V24h-3.4V11.4H9z" />
      <ellipse cx="16" cy="15.6" rx="7.4" ry="2.1" fill="none" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

/** Copies `text`; if the browser refuses (e.g. no clipboard access), selects the address so it can be copied by hand. */
function CopyButton({ text, label, target, variant = "default" }: { text: string; label: string; target: RefObject<HTMLElement | null>; variant?: "default" | "outline" }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const id = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(id);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      if (target.current) window.getSelection()?.selectAllChildren(target.current);
      setState("failed");
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => void copy()}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === "copied" ? t("support.copied") : label}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? t("support.copiedStatus") : ""}
      </span>
      {state === "failed" && (
        <p role="alert" className="text-destructive basis-full text-[13px]">
          {t("support.copyFailed")}
        </p>
      )}
    </>
  );
}

function Address({ value, refObj, labelId }: { value: string; refObj: RefObject<HTMLElement | null>; labelId?: string }) {
  return (
    <code
      ref={refObj}
      aria-labelledby={labelId}
      dir="ltr"
      translate="no"
      className="bg-muted text-foreground block rounded-md px-3 py-2.5 font-mono text-[13px] leading-relaxed break-all select-all"
    >
      {value}
    </code>
  );
}

function DonationCard({ method }: { method: DonationMethod }) {
  const { t } = useI18n();
  const k = KEY[method.id];
  const titleId = useId();
  const addressLabelId = useId();
  const addressRef = useRef<HTMLElement>(null);
  const okxRef = useRef<HTMLElement>(null);
  const title = t(`support.${k}.title` as TKey);

  return (
    <Panel aria-labelledby={titleId} className="flex flex-col p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <CoinIcon id={method.id} />
        <div className="min-w-0">
          <h3 id={titleId} className="text-lg font-semibold">
            {title}
          </h3>
          {k === "btc" && (
            <span className="bg-warning-soft text-warning-foreground mt-1 inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium">
              {t("support.btc.badge")}
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{t("support.asset")}</dt>
        <dd className="font-medium">{t(`support.${k}.asset` as TKey)}</dd>
        <dt className="text-muted-foreground">{t("support.network")}</dt>
        <dd className="font-medium">{t(`support.${k}.network` as TKey)}</dd>
      </dl>

      <Notice tone="warning" className="mt-4 flex gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t(`support.${k}.warning` as TKey)}</span>
      </Notice>

      {/* Always dark on white: scanners read inverted codes poorly, so the tile stays light in dark themes too. */}
      <div className="mt-5 flex justify-center">
        <div className="shadow-card rounded-lg border bg-white p-1.5">
          <img src={qrImagePath(method.id)} width={184} height={184} alt={t("support.qrAlt", { method: title })} className="block size-[184px]" />
        </div>
      </div>

      <p id={addressLabelId} className="text-muted-foreground mt-5 mb-1.5 text-[13px] font-medium">
        {t("support.address")}
      </p>
      <Address value={method.address} refObj={addressRef} labelId={addressLabelId} />
      <p className="text-muted-foreground mt-1.5 text-[12px]">{t("support.checkHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyButton text={method.address} label={t("support.copy")} target={addressRef} />
        <Button asChild variant="outline" size="sm">
          <a href={qrDownloadPath(method.id)} download={`listen-to-me-${method.id}-qr.png`}>
            <Download aria-hidden />
            {t("support.downloadQr")}
          </a>
        </Button>
      </div>

      {method.okxAddress && (
        <div className="mt-5 border-t pt-4">
          <p className="text-muted-foreground mb-2 text-[13px] leading-relaxed">{t("support.btc.okxNote")}</p>
          <Address value={method.okxAddress} refObj={okxRef} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton variant="outline" text={method.okxAddress} label={t("support.btc.copyOkx")} target={okxRef} />
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SupportPage() {
  const { t } = useI18n();

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-10 outline-none sm:px-6">
      <Link href="/" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md text-sm font-medium">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {t("support.back")}
      </Link>

      <div className="mt-5 max-w-3xl">
        <span aria-hidden className="bg-primary-soft text-primary-soft-foreground flex size-11 items-center justify-center rounded-full">
          <HandHeart className="size-5" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-[28px]">{t("support.title")}</h1>
        <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{t("support.intro")}</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel aria-labelledby="support-helps" className="p-5">
          <h2 id="support-helps" className="text-sm font-semibold">
            {t("support.helpsTitle")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {(["helps1", "helps2", "helps3"] as const).map((key) => (
              <li key={key} className="flex gap-2.5">
                <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t(`support.${key}`)}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Notice tone="info" className="flex gap-2.5 p-5 text-[14px]">
          <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
          <span>{t("support.direct")}</span>
        </Notice>
      </div>

      <section aria-labelledby="support-methods" className="mt-8">
        <h2 id="support-methods" className="text-lg font-semibold">
          {t("support.methodsTitle")}
        </h2>
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          {DONATION_METHODS.map((method) => (
            <DonationCard key={method.id} method={method} />
          ))}
        </div>
      </section>

      <section aria-labelledby="support-faq" className="mt-10">
        <h2 id="support-faq" className="text-lg font-semibold">
          {t("support.faqTitle")}
        </h2>
        <Panel className="mt-3 divide-y">
          {FAQ.map((n) => (
            <details key={n} className="group px-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3.5 font-medium [&::-webkit-details-marker]:hidden">
                {t(`support.faq${n}q`)}
                <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="text-muted-foreground pb-4 text-sm leading-relaxed">{t(`support.faq${n}a`)}</p>
            </details>
          ))}
        </Panel>
      </section>
    </main>
  );
}
