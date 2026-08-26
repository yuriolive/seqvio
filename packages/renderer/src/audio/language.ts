/**
 * Language selection for narration.
 *
 * Voice ids are provider-specific and easy to get wrong in a way that does not
 * fail: `edge-tts` happily reads an English script with a Mandarin voice, which
 * sounds subtly off rather than broken and survives review. `--lang` lets a
 * caller name the language and get a sensible voice for the active provider.
 */

export interface LanguageDefaults {
  /** BCP-47 tag, used for subtitle metadata and file naming. */
  tag: string;
  edgeTts: string;
  openai?: string;
}

/**
 * Default voice per language. Deliberately one obvious choice each rather than a
 * full catalogue: `edge-tts --list-voices` is the catalogue, and `--voice` still
 * overrides everything here.
 */
export const LANGUAGE_DEFAULTS: Record<string, LanguageDefaults> = {
  'en-US': { tag: 'en-US', edgeTts: 'en-US-AriaNeural', openai: 'alloy' },
  'en-GB': { tag: 'en-GB', edgeTts: 'en-GB-SoniaNeural', openai: 'alloy' },
  'pt-BR': { tag: 'pt-BR', edgeTts: 'pt-BR-FranciscaNeural', openai: 'nova' },
  'pt-PT': { tag: 'pt-PT', edgeTts: 'pt-PT-RaquelNeural', openai: 'nova' },
  'es-ES': { tag: 'es-ES', edgeTts: 'es-ES-ElviraNeural', openai: 'nova' },
  'es-MX': { tag: 'es-MX', edgeTts: 'es-MX-DaliaNeural', openai: 'nova' },
  'fr-FR': { tag: 'fr-FR', edgeTts: 'fr-FR-DeniseNeural', openai: 'nova' },
  'de-DE': { tag: 'de-DE', edgeTts: 'de-DE-KatjaNeural', openai: 'nova' },
  'it-IT': { tag: 'it-IT', edgeTts: 'it-IT-ElsaNeural', openai: 'nova' },
  'nl-NL': { tag: 'nl-NL', edgeTts: 'nl-NL-ColetteNeural', openai: 'nova' },
  'ja-JP': { tag: 'ja-JP', edgeTts: 'ja-JP-NanamiNeural', openai: 'nova' },
  'ko-KR': { tag: 'ko-KR', edgeTts: 'ko-KR-SunHiNeural', openai: 'nova' },
  'zh-CN': { tag: 'zh-CN', edgeTts: 'zh-CN-XiaoxiaoNeural', openai: 'nova' },
  'zh-TW': { tag: 'zh-TW', edgeTts: 'zh-TW-HsiaoChenNeural', openai: 'nova' },
  'hi-IN': { tag: 'hi-IN', edgeTts: 'hi-IN-SwaraNeural', openai: 'nova' },
  'ar-SA': { tag: 'ar-SA', edgeTts: 'ar-SA-ZariyahNeural', openai: 'nova' },
  'ru-RU': { tag: 'ru-RU', edgeTts: 'ru-RU-SvetlanaNeural', openai: 'nova' },
};

/** Bare language subtags accepted as shorthand for a regional default. */
const SHORTHAND: Record<string, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  nl: 'nl-NL',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  hi: 'hi-IN',
  ar: 'ar-SA',
  ru: 'ru-RU',
};

export function listLanguageTags(): string[] {
  return Object.keys(LANGUAGE_DEFAULTS);
}

export function resolveLanguage(input: string): LanguageDefaults {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  for (const [tag, defaults] of Object.entries(LANGUAGE_DEFAULTS)) {
    if (tag.toLowerCase() === lower) return defaults;
  }

  const shorthand = SHORTHAND[lower];
  if (shorthand) return LANGUAGE_DEFAULTS[shorthand];

  throw new Error(
    `Unknown --lang "${raw}". Known languages: ${listLanguageTags().join(', ')}. ` +
      'Use --voice to pass a provider voice id directly.'
  );
}
