import { translate, type Locale } from '../../shared/i18n.ts';
import { isSearchRestriction, searchUnavailable } from './searchService.ts';

const messages = {
  expired: ['ChatGPT 授权已过期或失效，请重新连接。', 'Your ChatGPT authorization has expired or is invalid. Please reconnect.'],
  ineligible: ['当前 ChatGPT 账号或工作区没有套餐使用资格。', 'This ChatGPT account or workspace is ineligible for plan usage.'],
  permission: ['当前 ChatGPT 授权或工作区策略不允许此请求。', 'Your ChatGPT permissions or workspace policy do not allow this request.'],
  limit: ['已达到 ChatGPT 套餐或此应用的用量限制，请在 Manage usage 查看。', 'You reached the ChatGPT plan or app usage limit. Select Manage usage to review it.'],
  rate_limit: ['ChatGPT 请求过于频繁，请稍后重试。', 'Too many requests to ChatGPT. Please try again shortly.'],
  unavailable: ['ChatGPT 暂时无法处理请求，请稍后重试。', 'ChatGPT is temporarily unable to handle your request. Please try again shortly.'],
  search_unavailable: [
    searchUnavailable('zh-CN') + '关闭搜索后仍可继续聊天。',
    searchUnavailable('en') + ' You can continue chatting with search turned off.',
  ],
  network: ['无法连接到 ChatGPT，请检查网络后重试。', 'Could not connect to ChatGPT. Check your connection and try again.'],
  timeout: ['ChatGPT 请求超时，请稍后重试。', 'The ChatGPT request timed out. Please try again.'],
  cancelled: ['已停止生成。', 'Stopped generating.'],
  incomplete: ['回答未完整生成，可以重试。', 'The answer was interrupted. You can try again.'],
  protocol: ['ChatGPT 返回了无法读取的响应，请稍后重试。', 'Could not read the ChatGPT response. Please try again shortly.'],
  rejected: ['ChatGPT 拒绝了此请求，请检查所选模型或稍后重试。', 'ChatGPT rejected this request. Check the selected model or try again shortly.'],
  no_model: ['当前账号没有可用的聊天模型，请检查 ChatGPT 授权。', 'This account has no available chat models. Check your ChatGPT authorization.'],
} as const;

export type AiErrorCode = keyof typeof messages;
export type AiStage = 'model-catalog' | 'response-admission' | 'response-media' | 'response-stream';

export function requestIdentifier(response: Response): string | undefined {
  const value = response.headers.get('x-request-id');
  return value && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : undefined;
}

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly stage?: AiStage;

  constructor(
    code: AiErrorCode,
    requestId?: string,
    status?: number,
    stage?: AiStage,
  ) {
    super(messages[code][0]);
    this.name = 'AiError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.stage = stage;
  }

  localized(locale?: Locale) {
    const [chinese, english] = messages[this.code];
    if (this.code === 'protocol' && this.stage === 'model-catalog') {
      return translate(locale, '无法读取 ChatGPT 返回的模型列表，请稍后重试。', 'Could not read the ChatGPT model list. Please try again shortly.');
    }
    return translate(locale, chinese, english);
  }
}

export function responseError(value: unknown, requestId?: string, status?: number, search = false, stage?: AiStage): AiError {
  const details = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const parameter = typeof details.param === 'string' ? details.param : '';
  let kind: AiErrorCode;

  if (search && isSearchRestriction(code, parameter)) {
    kind = 'search_unavailable';
  } else if (code === 'subscription_sharing_user_not_eligible') {
    kind = 'ineligible';
  } else if (code === 'subscription_sharing_usage_limit_exceeded') {
    kind = 'limit';
  } else if (code === 'subscription_sharing_invalid_user') {
    kind = 'expired';
  } else if (code === 'subscription_sharing_route_not_supported' || code.startsWith('chatpass_v2_')) {
    kind = 'permission';
  } else if (/^subscription_sharing_(usage|user)_unavailable$/.test(code) || code === 'server_error' || code === 'server_is_overloaded') {
    kind = 'unavailable';
  } else if (code === 'rate_limit_exceeded' || status === 429) {
    kind = 'rate_limit';
  } else if (status === 401) {
    kind = 'expired';
  } else if (status === 403) {
    kind = 'permission';
  } else if (status !== undefined && status >= 500) {
    kind = 'unavailable';
  } else {
    kind = 'rejected';
  }

  return new AiError(kind, requestId, status, stage);
}
