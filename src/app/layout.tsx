import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_DIR, isLocale, type Locale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { createTranslator } from "@/lib/i18n/translate";
import { ThemeProvider } from "@/lib/theme/provider";
import { VOICES, VOICE_LANGUAGES } from "@/lib/voices/catalog";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "@/lib/theme/themes";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

async function readPrefs() {
  const jar = await cookies();
  const localeCookie = jar.get(LOCALE_COOKIE)?.value;
  const themeCookie = jar.get(THEME_COOKIE)?.value;
  const locale: Locale = isLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;
  return { locale, theme };
}

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await readPrefs();
  const t = createTranslator(locale);
  const counts = { voices: VOICES.length, languages: VOICE_LANGUAGES.length };
  return {
    metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
    title: t("app.metaTitle"),
    description: t("app.metaDescription", counts),
    applicationName: "Listen to me",
    authors: [{ name: "Yousif AL_Shamri", url: "https://www.instagram.com/mmmmn/" }],
    creator: "Yousif AL_Shamri",
    keywords: ["text to speech", "TTS", "Arabic text to speech", "تحويل النص إلى كلام", "اسمعني", "PDF to audio", "translation"],
    openGraph: {
      type: "website",
      siteName: "Listen to me · اسمعني",
      title: t("app.metaTitle"),
      description: t("app.metaDescription", counts),
      locale: locale === "ar" ? "ar_AR" : "en_US",
      alternateLocale: locale === "ar" ? "en_US" : "ar_AR",
    },
    twitter: { card: "summary_large_image", title: t("app.metaTitle"), description: t("app.metaDescription", counts) },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, theme } = await readPrefs();
  return (
    <html lang={locale} dir={LOCALE_DIR[locale]} data-theme={theme} className={`${inter.variable} ${plexArabic.variable}`}>
      <body>
        <I18nProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>
            <TooltipProvider>
              <AppShell year={new Date().getFullYear()}>{children}</AppShell>
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
