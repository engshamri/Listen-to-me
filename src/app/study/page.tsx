import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StudyHome } from "@/components/study/study-home";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  return {
    title: t("study.metaTitle"),
    description: t("study.metaDescription"),
    alternates: { canonical: "/study" },
  };
}

export default function Study() {
  return <StudyHome />;
}
