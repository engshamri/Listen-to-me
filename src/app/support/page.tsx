import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SupportPage } from "@/components/support/support-page";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const t = createTranslator(isLocale(cookie) ? cookie : DEFAULT_LOCALE);
  const title = t("support.metaTitle");
  const description = t("support.metaDescription");
  return {
    title,
    description,
    alternates: { canonical: "/support" },
    openGraph: { type: "website", siteName: "Listen to me · اسمعني", url: "/support", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function Support() {
  return <SupportPage />;
}
