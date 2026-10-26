import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LibraryPage } from "@/components/library/library-page";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  return {
    title: t("library.metaTitle"),
    description: t("library.metaDescription"),
    alternates: { canonical: "/library" },
    // Personal and empty for crawlers: nothing to index.
    robots: { index: false },
  };
}

export default function Library() {
  return <LibraryPage />;
}
