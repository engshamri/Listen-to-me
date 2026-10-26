import type { Metadata } from "next";
import { cookies } from "next/headers";
import { StudyReview } from "@/components/study/study-review";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  // The cards exist only in the visitor's browser: nothing to index.
  return { title: `${t("study.review.title")} · ${t("app.name")}`, robots: { index: false } };
}

export default function StudyReviewPage() {
  return <StudyReview />;
}
