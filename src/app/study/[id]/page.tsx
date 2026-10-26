import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Workspace } from "@/components/study/workspace";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  // A lecture exists only in the visitor's browser: nothing to index.
  return { title: t("study.metaTitle"), robots: { index: false } };
}

export default async function StudyLecture({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string | string[] }> }) {
  const { id } = await params;
  // "?page=12" opens the lecture at that page (links from a search across a course).
  const page = Number((await searchParams).page);
  return <Workspace id={id} initialPage={Number.isInteger(page) && page > 0 ? page : undefined} />;
}
