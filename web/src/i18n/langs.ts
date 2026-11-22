// The interface languages: the code, the name in its own words, the English name (for Mnemo)
// and the HTML lang. No imports: the boot script in index.html and the app both use it.

export interface LangInfo {
  code: string;
  /** The region shown on the picker tile (`US`, `ID`). */
  flag: string;
  label: string;
  english: string;
  html: string;
  /** Written right to left (the page's direction follows). */
  rtl?: boolean;
}

export const LANGS: LangInfo[] = [
  { code: 'en', flag: 'US', label: 'English', english: 'English', html: 'en' },
  { code: 'vi', flag: 'VN', label: 'Tiếng Việt', english: 'Vietnamese', html: 'vi' },
  { code: 'zh', flag: 'CN', label: '简体中文', english: 'Simplified Chinese', html: 'zh-Hans' },
  { code: 'zh-TW', flag: 'TW', label: '繁體中文', english: 'Traditional Chinese', html: 'zh-Hant' },
  { code: 'ja', flag: 'JP', label: '日本語', english: 'Japanese', html: 'ja' },
  { code: 'pt', flag: 'BR', label: 'Português (Brasil)', english: 'Brazilian Portuguese', html: 'pt-BR' },
  { code: 'pt-PT', flag: 'PT', label: 'Português (Portugal)', english: 'European Portuguese', html: 'pt-PT' },
  { code: 'ko', flag: 'KR', label: '한국어', english: 'Korean', html: 'ko' },
  { code: 'es', flag: 'ES', label: 'Español', english: 'Spanish', html: 'es' },
  { code: 'de', flag: 'DE', label: 'Deutsch', english: 'German', html: 'de' },
  { code: 'fr', flag: 'FR', label: 'Français', english: 'French', html: 'fr' },
  { code: 'he', flag: 'IL', label: 'עברית', english: 'Hebrew', html: 'he', rtl: true },
  { code: 'ar', flag: 'SA', label: 'العربية', english: 'Arabic', html: 'ar', rtl: true },
  { code: 'ru', flag: 'RU', label: 'Русский', english: 'Russian', html: 'ru' },
  { code: 'pl', flag: 'PL', label: 'Polski', english: 'Polish', html: 'pl' },
  { code: 'cs', flag: 'CZ', label: 'Čeština', english: 'Czech', html: 'cs' },
  { code: 'nl', flag: 'NL', label: 'Nederlands', english: 'Dutch', html: 'nl' },
  { code: 'tr', flag: 'TR', label: 'Türkçe', english: 'Turkish', html: 'tr' },
  { code: 'uk', flag: 'UA', label: 'Українська', english: 'Ukrainian', html: 'uk' },
  { code: 'tl', flag: 'PH', label: 'Tagalog', english: 'Tagalog', html: 'tl' },
  { code: 'id', flag: 'ID', label: 'Bahasa Indonesia', english: 'Indonesian', html: 'id' },
  { code: 'km', flag: 'KH', label: 'ខ្មែរ', english: 'Khmer', html: 'km' },
  { code: 'th', flag: 'TH', label: 'ไทย', english: 'Thai', html: 'th' },
  { code: 'hi', flag: 'IN', label: 'हिन्दी', english: 'Hindi', html: 'hi' },
  { code: 'bn', flag: 'BD', label: 'বাংলা', english: 'Bengali', html: 'bn' },
  { code: 'ur', flag: 'PK', label: 'اردو', english: 'Urdu', html: 'ur', rtl: true },
  { code: 'ro', flag: 'RO', label: 'Română', english: 'Romanian', html: 'ro' },
  { code: 'sv', flag: 'SE', label: 'Svenska', english: 'Swedish', html: 'sv' },
  { code: 'it', flag: 'IT', label: 'Italiano', english: 'Italian', html: 'it' },
  { code: 'el', flag: 'GR', label: 'Ελληνικά', english: 'Greek', html: 'el' },
  { code: 'hu', flag: 'HU', label: 'Magyar', english: 'Hungarian', html: 'hu' },
  { code: 'fi', flag: 'FI', label: 'Suomi', english: 'Finnish', html: 'fi' },
  { code: 'da', flag: 'DK', label: 'Dansk', english: 'Danish', html: 'da' },
  { code: 'nb', flag: 'NO', label: 'Norsk', english: 'Norwegian', html: 'nb' },
  { code: 'fa', flag: 'IR', label: 'فارسی', english: 'Persian', html: 'fa', rtl: true },
];

export const LANG_KEY = 'memora.lang';

/** The language for a stored choice (`auto` or a code) and the browser's languages. */
export function pickLang(pref: string | null, browser: readonly string[]): string {
  if (pref && pref !== 'auto' && LANGS.some((l) => l.code === pref)) return pref;
  for (const raw of browser) {
    const c = String(raw || '').toLowerCase();
    if (c.startsWith('zh')) return /tw|hk|mo|hant/.test(c) ? 'zh-TW' : 'zh';
    if (c === 'pt-pt') return 'pt-PT';
    if (c.startsWith('no') || c.startsWith('nn')) return 'nb';
    if (c.startsWith('fil')) return 'tl';
    if (c.startsWith('ms')) return 'id';
    if (c.startsWith('pt')) return 'pt';
    const hit = LANGS.find((l) => l.code.toLowerCase() === c.split('-')[0]);
    if (hit) return hit.code;
  }
  return 'en';
}
