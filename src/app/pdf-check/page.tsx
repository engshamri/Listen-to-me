import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PdfCheck } from "@/components/pdf-check";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  // A support tool, linked from PDF error messages: not for search results.
  return { title: `${t("pdfCheck.title")} · ${t("app.name")}`, robots: { index: false } };
}

export default function PdfCheckPage() {
  return <PdfCheck />;
}
