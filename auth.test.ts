import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { AuthService, type ProtectedStorage } from '../electron/auth/siwcClient.ts'
import type { Locale } from '../shared/i18n.ts'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const clientId = 'oaiapp_test_profile'
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }

function issueId(audience: string, fields: Record<string, unknown>) {
  const jwtPart = (input: unknown) => Buffer.from(JSON.stringify(input)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const data = jwtPart({ alg: 'RS256', kid: jwk.kid }) + '.' + jwtPart({
    iss: issuer, aud: audience, sub: 'test-user', email: 'test@example.com', name: 'Test User', iat: now, exp: now + 3600, ...fields,
  })
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), signing.privateKey).toString('base64url')
}

function encryptedTestStorage(): ProtectedStorage {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}

interface Scenario {
  locale?: Locale
  callbackError?: string
  wrongStateFirst?: boolean
  callbackClient?: string
  omitClient?: boolean
  scope?: string
  claims?: Record<string, unknown>
  invalidSignature?: boolean
  revokeFailure?: boolean
  exchangeError?: string
  refreshError?: string
  expiredSoon?: boolean
  newIdentityOnRefresh?: boolean
  keysUnavailable?: boolean
  cancelCallback?: boolean
}

function fixture(t: TestContext, scenario: Scenario = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'meow-siwc-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const storage = encryptedTestStorage()
  const endpoints = {
    authorization_endpoint: issuer + '/api/accounts/authorize',
    token_endpoint: issuer + '/api/accounts/oauth/token',
    jwks_uri: issuer + '/.well-known/jwks.json',
    revocation_endpoint: issuer + '/api/accounts/oauth/revoke',
  }
  const browser: URL[] = []
  const browserPages: string[] = []
  const exchanges: URLSearchParams[] = []
  const refreshes: URLSearchParams[] = []
  const revocations: URLSearchParams[] = []
  const mockedFetch: typeof fetch = async (input, options) => {
    const url = String(input)
    assert.equal(options?.redirect, 'error')
    if (url === issuer + '/.well-known/openid-configuration') return Response.json({ issuer, ...endpoints })
    if (url === endpoints.jwks_uri) {
      if (scenario.keysUnavailable) return new Response(null, { status: 503 })
      return Response.json({ keys: [jwk] })
    }
    const form = options?.body
    assert.ok(form instanceof URLSearchParams)
    if (url === endpoints.revocation_endpoint) {
      revocations.push(form)
      return new Response(null, { status: scenario.revokeFailure ? 503 : 200 })
    }
    assert.equal(url, endpoints.token_endpoint)
    if (form.get('grant_type') === 'refresh_token') {
      refreshes.push(form)
      if (scenario.refreshError) return Response.json({ error: scenario.refreshError }, { status: 400 })
      return Response.json({
        access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 3600,
        ...(scenario.newIdentityOnRefresh && { id_token: issueId(form.get('client_id')!, { name: 'Updated User' }) }),
      })
    }
    exchanges.push(form)
    if (scenario.exchangeError) return Response.json({ error: scenario.exchangeError }, { status: 400 })
    const granted = scenario.scope ?? scopes
    const idToken = issueId(form.get('client_id')!, { nonce: browser.at(-1)!.searchParams.get('nonce'), ...scenario.claims })
    return Response.json({
      id_token: scenario.invalidSignature ? idToken.replace(/\.[^.]+$/, '.invalid') : idToken,
      scope: granted,
      ...(granted.includes('offline_access') && {
        access_token: 'initial-access', refresh_token: 'initial-refresh', token_type: 'Bearer', expires_in: scenario.expiredSoon ? 5 : 3600,
      }),
    })
  }

  let markOpened!: () => void
  const opened = new Promise<void>(resolve => { markOpened = resolve })
  const openBrowser = async (url: string) => {
    const authorization = new URL(url)
    assert.equal(authorization.origin + authorization.pathname, endpoints.authorization_endpoint)
    browser.push(authorization)
    markOpened()
    if (scenario.cancelCallback) return
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    assert.equal(callback.hostname, '127.0.0.1')
    assert.equal(callback.pathname, '/auth/callback')
    callback.searchParams.set('state', scenario.wrongStateFirst ? 'wrong' : authorization.searchParams.get('state')!)
    if (scenario.callbackError) callback.searchParams.set('error', scenario.callbackError)
    else callback.searchParams.set('code', 'test-code')
    if (!scenario.omitClient) callback.searchParams.set('client_id', scenario.callbackClient ?? clientId)
    if (scenario.wrongStateFirst) {
      const response = await fetch(callback)
      assert.equal(response.status, 400)
      await response.text()
      callback.searchParams.set('state', authorization.searchParams.get('state')!)
    }
    const response = await fetch(callback)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    browserPages.push(await response.text())
  }
  const makeService = () => new AuthService(directory, openBrowser, storage, mockedFetch, () => scenario.locale ?? 'zh-CN')
  return { directory, makeService, browser, browserPages, exchanges, refreshes, revocations, opened }
}

test('initial browser OAuth uses host ID, loopback, PKCE and the issued client ID', async t => {
  const { directory, makeService, browser, exchanges } = fixture(t, { wrongStateFirst: true })
  const service = makeService()
  assert.equal(service.status().state, 'signed-out')
  const auth = await service.signIn()
  assert.equal(auth.state, 'connected')
  assert.equal(auth.account?.email, 'test@example.com')
  assert.equal(await service.accessToken(), 'initial-access')
  assert.equal(browser[0].searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(browser[0].searchParams.get('agent_name_hint'), 'Dr. Meow')
  assert.match(browser[0].searchParams.get('ext_agent_host_id')!, /^urn:uuid:/)
  assert.equal(exchanges[0].get('client_id'), clientId)
  assert.equal(exchanges[0].get('resource'), resource)
  assert.equal(exchanges[0].get('redirect_uri'), browser[0].searchParams.get('redirect_uri'))
  assert.equal(createHash('sha256').update(exchanges[0].get('code_verifier')!).digest('base64url'), browser[0].searchParams.get('code_challenge'))
  assert.doesNotMatch(readFileSync(join(directory, 'chatgpt-auth.v1.enc')).toString(), /initial-access|test@example.com/)
  assert.equal(makeService().status().state, 'connected')
})

test('returning sign-in preserves the host and account registration', async t => {
  const scenario: Scenario = {}
  const { makeService, browser, exchanges } = fixture(t, scenario)
  await makeService().signIn()
  scenario.omitClient = true
  assert.equal((await makeService().signIn()).state, 'connected')
  assert.equal(browser[1].searchParams.get('client_id'), clientId)
  assert.equal(browser[1].searchParams.has('agent_name_hint'), false)
  assert.equal(browser[1].searchParams.get('login_hint'), 'test@example.com')
  assert.equal(browser[1].searchParams.get('ext_agent_host_id'), browser[0].searchParams.get('ext_agent_host_id'))
  assert.notEqual(browser[1].searchParams.get('nonce'), browser[0].searchParams.get('nonce'))
  assert.notEqual(browser[1].searchParams.get('state'), browser[0].searchParams.get('state'))
  assert.equal(exchanges[1].get('client_id'), clientId)
})

test('reuses an issued registration after a code exchange fails', async t => {
  const scenario: Scenario = { exchangeError: 'invalid_grant' }
  const { makeService, browser } = fixture(t, scenario)
  assert.equal((await makeService().signIn()).state, 'expired')
  scenario.exchangeError = undefined
  scenario.omitClient = true
  assert.equal((await makeService().signIn()).state, 'connected')
  assert.equal(browser[1].searchParams.get('client_id'), clientId)
})

test('explicit refusal never exchanges a code', async t => {
  const { makeService, exchanges } = fixture(t, { callbackError: 'access_denied' })
  assert.equal((await makeService().signIn()).state, 'denied')
  assert.equal(exchanges.length, 0)
})

test('localizes the sign-in callback and account status', async t => {
  const scenario: Scenario = { locale: 'en', callbackError: 'access_denied', scope: 'openid email profile' }
  const { makeService, browserPages } = fixture(t, scenario)
  const service = makeService()
  assert.match((await service.signIn()).message ?? '', /authorization was cancelled/)
  assert.match(browserPages[0], /lang="en"/)
  assert.match(browserPages[0], /Authorization was not completed/)

  scenario.callbackError = undefined
  assert.match((await service.signIn()).message ?? '', /Authorize ChatGPT plan usage/)
  scenario.locale = 'zh-CN'
  assert.match(service.status().message ?? '', /套餐使用权限/)
})

test('cancelling a pending browser sign-in closes the loopback listener', async t => {
  const { makeService, browser, opened } = fixture(t, { cancelCallback: true })
  const service = makeService()
  const pending = service.signIn()
  await opened
  service.cancel()
  assert.equal((await pending).state, 'denied')
  await assert.rejects(fetch(browser[0].searchParams.get('redirect_uri')!))
})

test('identity alone cannot make inference requests and can re-request consent', async t => {
  const scenario: Scenario = { scope: 'openid email profile' }
  const { makeService, browser } = fixture(t, scenario)
  const service = makeService()
  assert.equal((await service.signIn()).state, 'identity-only')
  await assert.rejects(service.accessToken(), { code: 'identity-only' })
  scenario.scope = scopes
  assert.equal((await service.signIn({ reconsent: true })).state, 'connected')
  assert.equal(browser[1].searchParams.get('prompt'), 'consent')
  assert.equal(browser[1].searchParams.get('client_id'), clientId)
})

test('rejects ID tokens with incorrect issuer, audience, nonce, or expiry', async t => {
  const scenario: Scenario = {}
  const { makeService } = fixture(t, scenario)
  const service = makeService()
  for (const claims of [{ iss: 'https://example.test' }, { aud: 'wrong' }, { nonce: 'wrong' }, { exp: 1 }]) {
    scenario.claims = claims
    assert.equal((await service.signIn()).state, 'error')
    await assert.rejects(service.accessToken(), { code: 'signed-out' })
  }
  scenario.claims = undefined
  scenario.invalidSignature = true
  assert.equal((await service.signIn()).state, 'error')
  await assert.rejects(service.accessToken(), { code: 'signed-out' })
})

test('a different returning subject cannot replace the active connection', async t => {
  const scenario: Scenario = {}
  const { makeService } = fixture(t, scenario)
  const service = makeService()
  await service.signIn()
  scenario.claims = { sub: 'unexpected-user', email: 'unexpected@example.com' }
  const result = await service.signIn()
  assert.match(result.message ?? '', /不同/)
  assert.equal(result.account?.email, 'test@example.com')
  assert.equal(await service.accessToken(), 'initial-access')
})

test('refreshes once for concurrent callers and persists the rotated grant', async t => {
  const { makeService, refreshes, revocations } = fixture(t, { expiredSoon: true })
  const service = makeService()
  await service.signIn()
  assert.deepEqual(await Promise.all([service.accessToken(), service.accessToken(true)]), ['rotated-access', 'rotated-access'])
  assert.equal(refreshes.length, 1)
  assert.equal(refreshes[0].get('refresh_token'), 'initial-refresh')
  assert.equal(refreshes[0].get('client_id'), clientId)
  assert.equal(refreshes[0].has('scope'), false)
  const restarted = makeService()
  assert.equal(await restarted.accessToken(), 'rotated-access')
  assert.equal((await restarted.signOut()).state, 'signed-out')
  assert.equal(revocations[0].get('token'), 'rotated-refresh')
  assert.equal(revocations[0].get('token_type_hint'), 'refresh_token')
  await assert.rejects(makeService().accessToken(), { code: 'signed-out' })
  assert.equal(makeService().status().accounts?.[0].id, clientId)
})

test('resumes an encrypted refresh checkpoint after identity-key service recovers', async t => {
  const scenario: Scenario = { newIdentityOnRefresh: true }
  const { makeService, refreshes } = fixture(t, scenario)
  const service = makeService()
  await service.signIn()
  scenario.keysUnavailable = true
  await assert.rejects(service.accessToken(true), { code: 'network' })
  scenario.keysUnavailable = false
  const restarted = makeService()
  assert.equal(await restarted.accessToken(), 'rotated-access')
  assert.equal(restarted.status().account?.name, 'Updated User')
  assert.equal(refreshes.length, 1)
})

test('a terminal refresh error marks the saved registration as expired', async t => {
  const { makeService } = fixture(t, { refreshError: 'invalid_grant' })
  const service = makeService()
  await service.signIn()
  await assert.rejects(service.accessToken(true), { code: 'expired' })
  assert.equal(makeService().status().state, 'expired')
  assert.equal((await service.signOut()).state, 'signed-out')
})

test('switches between distinct workspace registrations and resets the local vault', async t => {
  const scenario: Scenario = {}
  const { directory, makeService, browser, revocations } = fixture(t, scenario)
  const service = makeService()
  await service.signIn()
  scenario.callbackClient = 'oaiapp_second_workspace'
  const second = await service.signIn({ addAccount: true })
  assert.equal(second.account?.id, scenario.callbackClient)
  assert.deepEqual(second.accounts?.map(account => account.id), [clientId, scenario.callbackClient])
  scenario.omitClient = true
  const first = await service.signIn({ accountId: clientId })
  assert.equal(first.account?.id, clientId)
  assert.equal(browser.at(-1)?.searchParams.get('client_id'), clientId)
  assert.equal((await service.reset()).state, 'signed-out')
  assert.equal(existsSync(join(directory, 'chatgpt-auth.v1.enc')), false)
  assert.equal(revocations.length, 2)
  assert.deepEqual(makeService().status().accounts, [])
})

test('remote revocation failure still removes local credentials and reports the uncertainty', async t => {
  const { makeService, revocations } = fixture(t, { revokeFailure: true })
  const service = makeService()
  await service.signIn()
  const result = await service.signOut()
  assert.equal(result.state, 'signed-out')
  assert.match(result.message ?? '', /未能确认远程撤销/)
  assert.equal(revocations.length, 2)
  await assert.rejects(makeService().accessToken(), { code: 'signed-out' })
})
