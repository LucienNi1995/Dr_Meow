import type { Source } from '../../shared/contracts.ts';
import { translate, type Locale } from '../../shared/i18n.ts';

export function searchUnavailable(locale?: Locale) {
  return translate(locale, '当前账号或模型暂不支持联网搜索。', 'Web search is unavailable for this account or model.');
}

export function searchNotUsed(locale?: Locale) {
  return translate(locale, '本次回答没有进行联网搜索。', 'This answer did not use web search.');
}

export function likelyNeedsSearch(text: string): boolean {
  return /最新|实时|刚发布|查一下|搜一下|帮我搜索|联网搜索|(?:今天|今日|近期|最近).{0,16}(?:新闻|天气|动态|发布|进展|行情|活动)|\b(?:latest|breaking news|look up|search (?:the web|online)|current (?:price|weather|version)|today(?:’s|'s)? (?:news|weather|headlines))\b/i.test(text);
}

export function searchFields(required: boolean) {
  return { tools: [{ type: 'web_search' }], tool_choice: required ? 'required' : 'auto' };
}

export function isSearchRestriction(code: string, parameter: string): boolean {
  const toolParameter = /^(?:tools?(?:\b|[.\[])|tool_choice|web_search)/.test(parameter);
  const unsupported = /^(?:subscription_sharing_unsupported_capability|unsupported_tool|unsupported_parameter|unsupported_value|tool_not_supported)$/.test(code);
  return toolParameter && unsupported;
}

export function readCitation(value: unknown): Source | undefined {
  if (!value || typeof value !== 'object') return;
  const annotation = value as Record<string, unknown>;
  if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') return;

  let url: URL;
  try {
    url = new URL(annotation.url);
  } catch {
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;

  return {
    url: url.href,
    title: typeof annotation.title === 'string' && annotation.title.trim()
      ? annotation.title.slice(0, 300)
      : url.hostname,
  };
}
