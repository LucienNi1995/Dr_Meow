export type Locale = 'zh-CN' | 'en';

export function translate(locale: Locale | undefined, chinese: string, english: string): string {
  return locale === 'en' ? english : chinese;
}

export function translator(locale: Locale | undefined) {
  return (chinese: string, english: string) => translate(locale, chinese, english);
}

