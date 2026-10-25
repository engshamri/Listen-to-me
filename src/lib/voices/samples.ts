/**
 * Preview sentences. Written to be gender-neutral, since several languages
 * inflect verbs by the speaker's gender. Languages missing here get the
 * English sentence machine-translated on first use (then cached with the audio).
 */
export const PREVIEW_SAMPLES: Record<string, string> = {
  en: "Hello, my name is {name}. This is how I sound when I read your text.",
  ar: "مرحباً، اسمي {name}. هكذا يبدو صوتي عندما أقرأ نصك.",
  fr: "Bonjour, je m'appelle {name}. Voici comment je lis votre texte.",
  es: "Hola, me llamo {name}. Así suena mi voz cuando leo tu texto.",
  de: "Hallo, ich heiße {name}. So klingt meine Stimme, wenn ich deinen Text vorlese.",
  it: "Ciao, mi chiamo {name}. Ecco come suona la mia voce quando leggo il tuo testo.",
  pt: "Olá, o meu nome é {name}. É assim que soa a minha voz quando leio o seu texto.",
  ru: "Здравствуйте, меня зовут {name}. Вот так звучит мой голос, когда я читаю ваш текст.",
  tr: "Merhaba, benim adım {name}. Metninizi okurken sesim böyle duyulur.",
  fa: "سلام، اسم من {name} است. این نمونه‌ای از صدای من است.",
  ur: "السلام علیکم، میرا نام {name} ہے۔ یہ میری آواز کا نمونہ ہے۔",
  hi: "नमस्ते, मेरा नाम {name} है। यह मेरी आवाज़ का एक नमूना है।",
  zh: "你好，我的名字是{name}。这是我朗读文字时的声音。",
  "zh-TW": "你好，我的名字是{name}。這是我朗讀文字時的聲音。",
  "zh-HK": "你好，我的名字是{name}。這是我朗讀文字時的聲音。",
  ja: "こんにちは、{name}です。これが私の声のサンプルです。",
  ko: "안녕하세요, 저는 {name}입니다. 제 목소리는 이렇게 들립니다.",
  id: "Halo, nama saya {name}. Beginilah suara saya saat membacakan teks Anda.",
  ms: "Helo, nama saya {name}. Beginilah bunyi suara saya apabila membaca teks anda.",
  nl: "Hallo, mijn naam is {name}. Zo klinkt mijn stem als ik je tekst voorlees.",
  sv: "Hej, jag heter {name}. Så här låter min röst när jag läser din text.",
  nb: "Hei, jeg heter {name}. Slik høres stemmen min ut når jeg leser teksten din.",
  da: "Hej, jeg hedder {name}. Sådan lyder min stemme, når jeg læser din tekst op.",
  fi: "Hei, nimeni on {name}. Tältä ääneni kuulostaa, kun luen tekstisi.",
  pl: "Dzień dobry, mam na imię {name}. Tak brzmi mój głos podczas czytania tekstu.",
  uk: "Вітаю, мене звати {name}. Ось так звучить мій голос.",
  cs: "Dobrý den, jmenuji se {name}. Takhle zní můj hlas.",
  sk: "Dobrý deň, volám sa {name}. Takto znie môj hlas.",
  el: "Γεια σας, με λένε {name}. Έτσι ακούγεται η φωνή μου.",
  he: "שלום, קוראים לי {name}. כך נשמע הקול שלי.",
  hu: "Jó napot, a nevem {name}. Így szól a hangom.",
  ro: "Bună ziua, numele meu este {name}. Așa sună vocea mea.",
  vi: "Xin chào, tên tôi là {name}. Đây là giọng đọc của tôi.",
  th: "สวัสดี นี่คือตัวอย่างเสียงของ{name}",
  bn: "নমস্কার, আমার নাম {name}। এটি আমার কণ্ঠের একটি নমুনা।",
  ta: "வணக்கம், என் பெயர் {name}. இது என் குரலின் மாதிரி.",
  sw: "Habari, jina langu ni {name}. Hivi ndivyo sauti yangu inavyosikika.",
  af: "Hallo, my naam is {name}. So klink my stem.",
  ca: "Hola, em dic {name}. Així sona la meva veu.",
  hr: "Dobar dan, moje ime je {name}. Ovako zvuči moj glas.",
  bg: "Здравейте, казвам се {name}. Ето как звучи гласът ми.",
  sr: "Здраво, моје име је {name}. Овако звучи мој глас.",
  sl: "Pozdravljeni, moje ime je {name}. Tako zveni moj glas.",
  lt: "Laba diena, mano vardas {name}. Taip skamba mano balsas.",
  lv: "Labdien, mani sauc {name}. Tā skan mana balss.",
  et: "Tere, minu nimi on {name}. Nii kõlab minu hääl.",
  fil: "Kumusta, ang pangalan ko ay {name}. Ganito ang tunog ng aking boses.",
  gl: "Ola, chámome {name}. Así soa a miña voz.",
};

export function sampleFor(locale: string, lang: string): string | null {
  return PREVIEW_SAMPLES[locale] ?? PREVIEW_SAMPLES[locale.split("-").slice(0, 2).join("-")] ?? PREVIEW_SAMPLES[lang] ?? null;
}
