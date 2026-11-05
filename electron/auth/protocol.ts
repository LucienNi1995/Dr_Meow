import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { AuthStatus } from '../../shared/contracts.ts'
import { translate, type Locale } from '../../shared/i18n.ts'

export const ISSUER = 'https://auth.openai.com'
export const RESOURCE = 'https://api.openai.com/v1'
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const DYNAMIC_CLIENT = 'dynamic_agent_client'
const REQUESTED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE]
const CALLBACK_PATH = '/auth/callback'
const invalidRefresh = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])
type Fields = Record<string, unknown>

export class AuthError extends Error {
  readonly code: AuthStatus['state']
  private readonly english: string

  constructor(code: AuthStatus['state'], chinese: string, english: string) {
    super(chinese)
    this.name = 'AuthError'
    this.code = code
    this.english = english
  }

  localized(locale?: Locale) {
    return translate(locale, this.message, this.english)
  }
}

interface Provider {
  authorization: string
  token: string
  keys: string
  revocation?: string
}

interface Registration {
  clientId: string
  email?: string
}

interface Authorization {
  code: string
  clientId: string
}

export interface Identity {
  subject: string
  email?: string
  name?: string
}

export interface TokenSet {
  scopes: string[]
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  refreshAfter?: number
  idToken: string
}

export const asObject = (value: unknown): Fields => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {}
export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0
export const validClientId = (value: unknown): value is string => nonempty(value) && value !== DYNAMIC_CLIENT && /^[a-zA-Z0-9_~-]{1,256}$/.test(value)
export const hasPlan = (scopes: string[]) => scopes.includes(PLAN_SCOPE)

export const denied = () => new AuthError('denied', '已取消 ChatGPT 授权。', 'ChatGPT authorization was cancelled.')
const invalidIdentity = () => new AuthError('error', '无法验证 ChatGPT 身份，请重新登录。', 'Could not verify your ChatGPT identity. Please sign in again.')
const invalidTokens = () => new AuthError('error', 'ChatGPT 返回的授权凭据不完整，请重新登录。', 'ChatGPT returned incomplete credentials. Please sign in again.')
const randomValue = () => randomBytes(32).toString('base64url')

function providerEndpoint(value: unknown): string {
  try {
    const url = new URL(String(value))
    if (url.origin === ISSUER && !url.username && !url.password && !url.search && !url.hash) return url.href
  } catch {
    // Malformed or untrusted provider metadata.
  }
  throw new AuthError('error', '无法验证 ChatGPT 登录服务配置。', 'Could not verify the ChatGPT sign-in configuration.')
}

function callbackListener(state: string, clientId: string | undefined, signal: AbortSignal, locale: Locale) {
  const expectedState = Buffer.from(state)
  const scrubQuery = 'history.replaceState(null, "", "/auth/complete")'
  const scriptHash = createHash('sha256').update(scrubQuery).digest('base64')
  let resolveResult!: (value: Authorization) => void
  let rejectResult!: (error: Error) => void
  let done = false
  let host: string
  const result = new Promise<Authorization>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // The browser may already have called back before its launch promise settles.
  void result.catch(() => undefined)

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000 }, (request, response) => {
    const origin = 'http://' + host
    let url: URL
    try { url = new URL(request.url ?? '/', origin) } catch {
      response.writeHead(400).end()
      return
    }

    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; script-src 'sha256-" + scriptHash + "'")
    if (done || request.method !== 'GET' || request.headers.host !== host || url.origin !== origin || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end()
      return
    }

    const provided = Buffer.from(url.searchParams.get('state') ?? '')
    if (url.searchParams.getAll('state').length !== 1 || provided.length !== expectedState.length || !timingSafeEqual(provided, expectedState)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(translate(locale, '登录状态无效。', 'Invalid sign-in state.'))
      return
    }

    done = true
    const reply = (message: string) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
      response.end('<!doctype html><html lang="' + locale + '"><meta charset="utf-8"><title>Dr. Meow</title><p>' + message + '</p><script>' + scrubQuery + '</script></html>')
    }
    const oauthError = url.searchParams.get('error')
    const returnedClient = url.searchParams.get('client_id')
    const issued = clientId ?? returnedClient
    const code = url.searchParams.get('code')
    if (oauthError) {
      reply(translate(locale, '授权未完成。请返回 Dr. Meow。', 'Authorization was not completed. Please return to Dr. Meow.'))
      rejectResult(oauthError === 'access_denied' ? denied() : new AuthError('error', 'ChatGPT 未能完成授权，请返回应用重试。', 'ChatGPT could not complete authorization. Return to the app to try again.'))
    } else if (!code || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1 || !validClientId(issued) || (returnedClient !== null && issued !== returnedClient)) {
      reply(translate(locale, '授权回调无效。请返回 Dr. Meow 重试。', 'The authorization callback was invalid. Return to Dr. Meow to try again.'))
      rejectResult(new AuthError('error', 'ChatGPT 返回的授权回调不完整或与所选账号不匹配。', 'The ChatGPT callback was incomplete or did not match the selected account.'))
    } else {
      reply(translate(locale, '已收到 ChatGPT 授权。请返回 Dr. Meow 查看结果。', 'ChatGPT authorization was received. Return to Dr. Meow to see the result.'))
      resolveResult({ code, clientId: issued })
    }
  })
  server.setTimeout(5000, socket => socket.destroy())
  server.maxConnections = 16
  const opened = new Promise<string>((resolve, reject) => {
    server.once('error', () => {
      const error = new AuthError('error', '无法启动本地登录回调，请重试。', 'Could not start the local sign-in callback. Please try again.')
      reject(error)
      rejectResult(error)
    })
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      host = '127.0.0.1:' + (server.address() as AddressInfo).port
      resolve('http://' + host + CALLBACK_PATH)
    })
  })

  const onAbort = () => rejectResult(denied())
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  return {
    opened,
    result,
    close() {
      signal.removeEventListener('abort', onAbort)
      server.close()
      server.closeIdleConnections()
    },
  }
}

export class SiwcProtocol {
  private configuration?: Promise<Provider>
  private readonly request: typeof fetch

  constructor(request: typeof fetch) {
    this.request = request
  }

  private async fetch(url: string, init?: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(12_000)
    try {
      return await this.request(url, { ...init, credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    } catch {
      if (signal?.aborted) throw denied()
      throw new AuthError('network', '无法连接 ChatGPT 登录服务。请检查网络后重试。', 'Could not reach the ChatGPT sign-in service. Check your connection and try again.')
    }
  }

  private async json(response: Response) {
    return asObject(await response.json().catch(() => undefined))
  }

  private discovery() {
    this.configuration ??= (async () => {
      const response = await this.fetch(ISSUER + '/.well-known/openid-configuration')
      const data = await this.json(response)
      if (!response.ok || data.issuer !== ISSUER) {
        throw new AuthError(response.status >= 500 ? 'network' : 'error', '无法取得 ChatGPT 登录服务配置。', 'Could not load the ChatGPT sign-in configuration.')
      }
      return {
        authorization: providerEndpoint(data.authorization_endpoint),
        token: providerEndpoint(data.token_endpoint),
        keys: providerEndpoint(data.jwks_uri),
        revocation: data.revocation_endpoint === undefined ? undefined : providerEndpoint(data.revocation_endpoint),
      }
    })().catch((error: unknown) => {
      this.configuration = undefined
      throw error
    })
    return this.configuration
  }

  async authorize(
    hostId: string,
    previous: Registration | undefined,
    reconsent: boolean,
    openBrowser: (url: string) => Promise<void>,
    persistClientId: (clientId: string) => void,
    signal: AbortSignal,
    locale: Locale,
  ): Promise<{ clientId: string; identity: Identity; tokens: TokenSet }> {
    const provider = await this.discovery()
    if (signal.aborted) throw denied()
    const state = randomValue()
    const nonce = randomValue()
    const verifier = randomValue()
    const listener = callbackListener(state, previous?.clientId, signal, locale)
    let redirect: string
    let callback: Authorization
    try {
      redirect = await listener.opened
      if (signal.aborted) throw denied()
      const url = new URL(provider.authorization)
      url.search = new URLSearchParams({
        client_id: previous?.clientId ?? DYNAMIC_CLIENT,
        ext_agent_host_id: hostId,
        resource: RESOURCE,
        scope: REQUESTED_SCOPES.join(' '),
        redirect_uri: redirect,
        response_type: 'code',
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString()
      if (!previous) url.searchParams.set('agent_name_hint', 'Dr. Meow')
      if (previous?.email) url.searchParams.set('login_hint', previous.email)
      // Use the documented login hint without sending an ID token through a browser launch command.
      if (reconsent && previous) url.searchParams.set('prompt', 'consent')
      await openBrowser(url.href).catch(() => {
        throw new AuthError('error', '无法打开系统浏览器。请检查默认浏览器后重试。', 'Could not open your default browser. Check your browser settings and try again.')
      })
      callback = await listener.result
    } finally {
      listener.close()
    }

    if (signal.aborted) throw denied()
    persistClientId(callback.clientId)
    const data = await this.tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: callback.clientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: RESOURCE,
    }), signal)
    if (!nonempty(data.id_token)) throw invalidIdentity()
    const tokens = parseTokenSet(data, data.id_token)
    const identity = await this.identity(tokens.idToken, callback.clientId, { nonce, signal })
    if (signal.aborted) throw denied()
    return { clientId: callback.clientId, identity, tokens }
  }

  async refresh(clientId: string, old: TokenSet) {
    if (!old.refreshToken) throw new AuthError('expired', 'ChatGPT 会话已过期，请重新登录。', 'Your ChatGPT session has expired. Please sign in again.')
    const data = await this.tokenRequest(new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: old.refreshToken,
      resource: RESOURCE,
    }))
    try {
      if (data.id_token !== undefined && !nonempty(data.id_token)) throw invalidIdentity()
      return parseTokenSet(data, typeof data.id_token === 'string' ? data.id_token : old.idToken, old)
    } catch {
      throw new AuthError('expired', 'ChatGPT 返回的续期凭据无法使用，请重新登录。', 'ChatGPT returned unusable renewal credentials. Please sign in again.')
    }
  }

  async identity(idToken: string, clientId: string, options: { nonce?: string; receivedAt?: number; signal?: AbortSignal } = {}): Promise<Identity> {
    let header: Fields
    let claims: Fields
    const parts = idToken.split('.')
    try {
      if (parts.length !== 3 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw invalidIdentity()
      header = asObject(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')))
      claims = asObject(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')))
    } catch { throw invalidIdentity() }

    if (header.alg !== 'RS256' || !nonempty(header.kid) || header.crit !== undefined) throw invalidIdentity()
    const provider = await this.discovery()
    const response = await this.fetch(provider.keys, undefined, options.signal)
    const data = await this.json(response)
    if (!response.ok || !Array.isArray(data.keys)) {
      throw new AuthError('network', 'ChatGPT 身份验证服务暂不可用，请稍后重试。', 'ChatGPT identity verification is temporarily unavailable. Please try again shortly.')
    }
    const matches = data.keys.map(asObject).filter(key => key.kid === header.kid && key.kty === 'RSA' &&
      (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'))
    if (matches.length !== 1) throw new AuthError('network', '暂时找不到 ChatGPT 身份验证密钥，请稍后重试。', 'The ChatGPT identity verification key is temporarily unavailable. Please try again shortly.')
    let verified = false
    try {
      const key = createPublicKey({ key: matches[0] as JsonWebKey, format: 'jwk' })
      verified = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))
    } catch { throw invalidIdentity() }

    const now = (options.receivedAt ?? Date.now()) / 1000
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!verified || claims.iss !== ISSUER || !nonempty(claims.sub) || !audiences.includes(clientId) ||
        (claims.azp !== undefined && claims.azp !== clientId) || (audiences.length > 1 && claims.azp !== clientId) ||
        typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + 5 ||
        typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now - 5 ||
        (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now + 5)) ||
        (options.nonce !== undefined && claims.nonce !== options.nonce)) throw invalidIdentity()

    return {
      subject: claims.sub,
      ...(nonempty(claims.name) && { name: claims.name }),
      ...(nonempty(claims.email) && { email: claims.email }),
    }
  }

  private async tokenRequest(body: URLSearchParams, signal?: AbortSignal) {
    const provider = await this.discovery()
    const response = await this.fetch(provider.token, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    }, signal)
    const data = await this.json(response)
    if (response.ok) return data
    const code = typeof data.error === 'string' ? data.error : asObject(data.error).code
    if (code === 'access_denied') throw denied()
    if (typeof code === 'string' && invalidRefresh.has(code)) {
      throw new AuthError('expired', 'ChatGPT 授权已过期，请重新登录。', 'Your ChatGPT authorization has expired. Please sign in again.')
    }
    if (code === 'subscription_sharing_user_not_eligible' || response.status === 403) {
      throw new AuthError('ineligible', '当前 ChatGPT 账号、工作区或地区无法使用套餐授权。', 'ChatGPT plan usage is unavailable for this account, workspace, or region.')
    }
    if (response.status === 429) throw new AuthError('limited', 'ChatGPT 暂时限制了请求，请查看用量或稍后重试。', 'ChatGPT is limiting requests. Check your usage or try again shortly.')
    if (response.status >= 500) throw new AuthError('network', 'ChatGPT 登录服务暂不可用，请稍后重试。', 'The ChatGPT sign-in service is temporarily unavailable. Please try again shortly.')
    throw new AuthError('error', 'ChatGPT 未接受本次授权。请重新登录。', 'ChatGPT did not accept this authorization. Please sign in again.')
  }

  async revoke(clientId: string, refreshToken: string): Promise<boolean> {
    try {
      const provider = await this.discovery()
      if (!provider.revocation) return false
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.fetch(provider.revocation, {
            method: 'POST',
            body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }),
          })
          await response.body?.cancel().catch(() => undefined)
          if (response.status === 200) return true
          if (response.status < 500) return false
        } catch {
          // Retry transient failure once before proceeding with local sign-out.
        }
        if (attempt === 0) await delay(400)
      }
    } catch {
      // Discovery failure also allows local sign-out.
    }
    return false
  }
}

function parseTokenSet(data: Fields, idToken: string, previous?: TokenSet): TokenSet {
  const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : data.scope === undefined ? previous?.scopes : undefined
  if (!scopes || (!previous && !scopes.includes('openid'))) throw invalidTokens()
  if (!nonempty(data.access_token)) {
    if (previous || hasPlan(scopes) || scopes.includes('offline_access')) throw invalidTokens()
    return { idToken, scopes }
  }
  const expiresAt = typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : 0
  const earliest = data.earliest_refresh_at
  const refreshAfter = typeof earliest === 'number' ? earliest * 1000 : typeof earliest === 'string' ? Date.parse(earliest) : NaN
  if (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
      ((previous || scopes.includes('offline_access')) && !nonempty(data.refresh_token))) throw invalidTokens()

  return {
    scopes,
    idToken,
    accessToken: data.access_token,
    expiresAt,
    ...(Number.isFinite(refreshAfter) && { refreshAfter }),
    ...(nonempty(data.refresh_token) && { refreshToken: data.refresh_token }),
  }
}
