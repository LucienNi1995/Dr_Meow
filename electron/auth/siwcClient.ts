import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, AuthStatus, SignInOptions } from '../../shared/contracts.ts'
import { translate, type Locale } from '../../shared/i18n.ts'
import { asObject, AuthError, denied, hasPlan, nonempty, SiwcProtocol, validClientId, type Identity, type TokenSet } from './protocol.ts'

export { AuthError } from './protocol.ts'

export interface ProtectedStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface Profile {
  clientId: string
  identity: Identity
  session?: TokenSet
  expired?: boolean
  pendingRotation?: { session: TokenSet; receivedAt: number }
}

interface Vault {
  version: 1
  hostId: string
  profiles: Profile[]
  activeId?: string
  pendingClientId?: string
}

const storageError = () => new AuthError('error', '无法读取或写入系统加密凭据。请检查本地数据设置。', 'Could not read or save your encrypted credentials. Check your local data settings.')
const signedOut = () => new AuthError('signed-out', '请先使用 ChatGPT 登录。', 'Please sign in with ChatGPT first.')
const noPlan = () => new AuthError('identity-only', '账号已连接，但尚未授予 ChatGPT 套餐使用权限。', 'Your account is connected. Authorize ChatGPT plan usage to start chatting.')
const expired = () => new AuthError('expired', 'ChatGPT 会话已过期，请重新登录。', 'Your ChatGPT session has expired. Please sign in again.')
const mismatched = () => new AuthError('error', 'ChatGPT 返回了不同的账号。请选择原账号，或添加独立账号。', 'ChatGPT returned a different account. Select the original account or add a separate one.')
const freshVault = (): Vault => ({ version: 1, hostId: 'urn:uuid:' + randomUUID(), profiles: [] })

function summarize(profile: Profile): Account {
  return { id: profile.clientId, email: profile.identity.email, name: profile.identity.name }
}

function validateVault(value: unknown): Vault {
  const vault = asObject(value)
  if (vault.version !== 1 || !nonempty(vault.hostId) || !/^urn:uuid:[a-f0-9-]{36}$/.test(vault.hostId) || !Array.isArray(vault.profiles)) {
    throw storageError()
  }
  for (const value of vault.profiles) {
    const profile = asObject(value)
    if (!validClientId(profile.clientId) || !nonempty(asObject(profile.identity).subject)) throw storageError()
    if (profile.session && !validSession(profile.session)) throw storageError()
    if (profile.pendingRotation) {
      const rotation = asObject(profile.pendingRotation)
      if (!validSession(rotation.session) || typeof rotation.receivedAt !== 'number') throw storageError()
    }
  }
  if ((vault.activeId !== undefined && !validClientId(vault.activeId)) ||
      (vault.pendingClientId !== undefined && !validClientId(vault.pendingClientId))) throw storageError()
  return vault as unknown as Vault
}

function validSession(value: unknown) {
  const session = asObject(value)
  return nonempty(session.idToken) && Array.isArray(session.scopes) && session.scopes.every(nonempty) &&
    (session.accessToken === undefined || (nonempty(session.accessToken) && typeof session.expiresAt === 'number')) &&
    (session.refreshAfter === undefined || typeof session.refreshAfter === 'number') &&
    (session.refreshToken === undefined || nonempty(session.refreshToken))
}

function asAuthError(error: unknown) {
  return error instanceof AuthError ? error : new AuthError('error', '无法完成 ChatGPT 连接，请重试。', 'Could not connect your ChatGPT account. Please try again.')
}

export class AuthService {
  private readonly userData: string
  private readonly openBrowser: (url: string) => Promise<void>
  private readonly storage: ProtectedStorage
  private readonly locale: () => Locale
  private readonly path: string
  private readonly protocol: SiwcProtocol
  private vault = freshVault()
  private loadFailure = false
  private operation = Promise.resolve()
  private signingIn?: { abort: AbortController; result: Promise<AuthStatus> }
  private refreshing?: { accountId: string; result: Promise<string> }
  private stopping = 0

  constructor(
    userData: string,
    openBrowser: (url: string) => Promise<void>,
    storage: ProtectedStorage,
    fetcher: typeof fetch = globalThis.fetch,
    locale: () => Locale = () => 'zh-CN',
  ) {
    this.userData = userData
    this.openBrowser = openBrowser
    this.storage = storage
    this.locale = locale
    this.path = join(userData, 'chatgpt-auth.v1.enc')
    this.protocol = new SiwcProtocol(fetcher)
    try {
      const file = readFileSync(this.path)
      if (!storage.isEncryptionAvailable()) throw storageError()
      this.vault = validateVault(JSON.parse(storage.decryptString(file)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadFailure = true
    }
  }

  private commit(vault: Vault) {
    if (this.loadFailure || !this.storage.isEncryptionAvailable()) throw storageError()
    const temp = this.path + '.' + randomUUID() + '.tmp'
    try {
      mkdirSync(this.userData, { recursive: true })
      writeFileSync(temp, this.storage.encryptString(JSON.stringify(vault)), { mode: 0o600, flag: 'wx', flush: true })
      renameSync(temp, this.path)
      this.vault = vault
    } catch {
      try { rmSync(temp, { force: true }) } catch { /* Preserve the original failure. */ }
      throw storageError()
    }
  }

  private active() {
    return this.vault.profiles.find(profile => profile.clientId === this.vault.activeId)
  }

  private withProfile(profile: Profile): Vault {
    const profiles = this.vault.profiles
    return {
      ...this.vault,
      profiles: profiles.some(item => item.clientId === profile.clientId)
        ? profiles.map(item => item.clientId === profile.clientId ? profile : item)
        : [...profiles, profile],
    }
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.operation.then(run)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }

  status(): AuthStatus {
    if (this.loadFailure) return { state: 'error', message: storageError().localized(this.locale()) }
    const account = this.active()
    const accounts = this.vault.profiles.map(summarize)
    const common = { accounts, ...(account && { account: summarize(account) }) }
    if (this.stopping) return { state: 'signed-out', ...common }
    if (account?.expired) return { state: 'expired', ...common, message: expired().localized(this.locale()) }
    if (!account?.session) return { state: 'signed-out', ...common }
    if (!hasPlan(account.session.scopes)) return { state: 'identity-only', ...common, message: noPlan().localized(this.locale()) }
    if (account.session.refreshToken || (account.session.expiresAt ?? 0) > Date.now()) {
      return { state: 'connected', ...common }
    }
    return { state: 'expired', ...common, message: expired().localized(this.locale()) }
  }

  private failed(error: unknown): AuthStatus {
    const failure = asAuthError(error)
    const current = this.status()
    return {
      ...current,
      // An abandoned account switch must leave a working connection usable.
      state: current.state === 'connected' || current.state === 'identity-only' ? current.state : failure.code,
      message: failure.localized(this.locale()),
    }
  }

  signIn(options: SignInOptions = {}): Promise<AuthStatus> {
    if (this.signingIn) return this.signingIn.result
    const abort = new AbortController()
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(3 * 60_000)])
    const result = this.exclusive(async () => {
      if (signal.aborted) throw denied()
      if (this.loadFailure) throw storageError()
      const selected = options.accountId
        ? this.vault.profiles.find(profile => profile.clientId === options.accountId)
        : options.addAccount ? undefined : this.active()
      if (options.accountId && !selected) throw new AuthError('error', '找不到所选的 ChatGPT 账号。', 'Could not find the selected ChatGPT account.')
      const previous = selected
        ? { clientId: selected.clientId, email: selected.identity.email }
        : this.vault.pendingClientId ? { clientId: this.vault.pendingClientId } : undefined

      // Write the host identifier before opening the browser, even on a first launch.
      this.commit(this.vault)
      const { clientId, identity, tokens } = await this.protocol.authorize(
        this.vault.hostId,
        previous,
        options.reconsent === true,
        this.openBrowser,
        issued => {
          if (!selected && !this.vault.profiles.some(profile => profile.clientId === issued)) {
            this.commit({ ...this.vault, pendingClientId: issued })
          }
        },
        signal,
        this.locale(),
      )
      const existing = this.vault.profiles.find(profile => profile.clientId === clientId)
      if (existing && existing.identity.subject !== identity.subject) throw mismatched()

      const vault = this.withProfile({ clientId, identity, session: tokens })
      this.commit({
        ...vault,
        activeId: clientId,
        pendingClientId: vault.pendingClientId === clientId ? undefined : vault.pendingClientId,
      })
      return this.status()
    }).catch(error => this.failed(error)).finally(() => {
      this.signingIn = undefined
    })
    this.signingIn = { abort, result }
    return result
  }

  cancel() {
    this.signingIn?.abort.abort()
  }

  async accessToken(forceRefresh = false): Promise<string> {
    if (this.loadFailure) throw storageError()
    if (this.stopping) throw signedOut()
    const profile = this.active()
    if (profile?.expired) throw expired()
    if (!profile?.session) throw signedOut()
    if (!hasPlan(profile.session.scopes)) throw noPlan()
    if (this.refreshing?.accountId === profile.clientId) return this.refreshing.result
    if (!profile.pendingRotation) {
      const session = profile.session
      const now = Date.now()
      const remaining = (session.expiresAt ?? 0) - now
      const allowed = (session.refreshAfter ?? 0) <= now
      if (!forceRefresh && session.accessToken && remaining > 0 && (remaining > 30_000 || !session.refreshToken || !allowed)) {
        return session.accessToken
      }
      if (!allowed) throw new AuthError('network', 'ChatGPT 暂时无法续期，请稍后重试。', 'Your ChatGPT session cannot be renewed yet. Try again shortly.')
    }

    const result = this.exclusive(async () => {
      if (this.stopping) throw signedOut()
      const selected = this.active()
      if (selected?.clientId !== profile.clientId) throw signedOut()
      return this.renew(selected)
    }).finally(() => {
      if (this.refreshing?.result === result) this.refreshing = undefined
    })
    this.refreshing = { accountId: profile.clientId, result }
    return result
  }

  private async renew(profile: Profile): Promise<string> {
    const previous = profile.session
    if (!previous) throw expired()
    if (!hasPlan(previous.scopes)) throw noPlan()
    let rotation = profile.pendingRotation
    try {
      if (!rotation) {
        const session = await this.protocol.refresh(profile.clientId, previous)
        if (session.idToken !== previous.idToken) {
          rotation = { session, receivedAt: Date.now() }
          // A successful refresh can invalidate the old token before key retrieval.
          this.persistRotated(this.withProfile({ ...profile, pendingRotation: rotation }))
        } else {
          this.persistRotated(this.withProfile({ ...profile, session }))
          if (!hasPlan(session.scopes)) throw noPlan()
          return session.accessToken!
        }
      }
      let identity: Identity
      try {
        identity = await this.protocol.identity(rotation.session.idToken, profile.clientId, { receivedAt: rotation.receivedAt })
        if (identity.subject !== profile.identity.subject) throw mismatched()
      } catch (error) {
        const failure = asAuthError(error)
        if (failure.code === 'error') throw new AuthError('expired', '无法验证 ChatGPT 续期身份，请重新登录。', 'Could not verify your ChatGPT identity during renewal. Please sign in again.')
        throw failure
      }
      this.commit(this.withProfile({ clientId: profile.clientId, identity, session: rotation.session }))
      if (!hasPlan(rotation.session.scopes)) throw noPlan()
      if ((rotation.session.expiresAt ?? 0) <= Date.now()) {
        throw new AuthError('network', 'ChatGPT 凭据已恢复，请重试以续期。', 'Your ChatGPT credentials were recovered. Retry to renew your session.')
      }
      return rotation.session.accessToken!
    } catch (error) {
      const failure = asAuthError(error)
      if (failure.code === 'expired') {
        this.commit(this.withProfile({ clientId: profile.clientId, identity: profile.identity, expired: true }))
      }
      throw failure
    }
  }

  private persistRotated(vault: Vault) {
    try {
      this.commit(vault)
    } catch (error) {
      // The previous refresh token may already be invalid. Retain its replacement
      // in memory so a transient write failure never causes another use of it.
      this.vault = vault
      throw error
    }
  }

  private async revoke(profile: Profile): Promise<boolean> {
    const token = profile.pendingRotation?.session.refreshToken ?? profile.session?.refreshToken
    if (token) return this.protocol.revoke(profile.clientId, token)
    return !profile.session?.accessToken
  }

  async signOut(): Promise<AuthStatus> {
    this.cancel()
    this.stopping++
    let confirmed: boolean
    try {
      confirmed = await this.exclusive(async () => {
        const profile = this.active()
        if (!profile) return true
        const revoked = await this.revoke(profile)
        this.commit(this.withProfile({ clientId: profile.clientId, identity: profile.identity }))
        return revoked
      })
    } catch (error) {
      return { ...this.status(), state: 'error', message: asAuthError(error).localized(this.locale()) }
    } finally {
      this.stopping--
    }
    return {
      ...this.status(),
      ...(!confirmed && { message: translate(this.locale(),
        '已在本机注销。未能确认远程撤销，可在 ChatGPT 设置中断开 Dr. Meow。',
        'You are signed out on this device. You can disconnect Dr. Meow in ChatGPT settings to confirm that access has been revoked.') }),
    }
  }

  async reset(): Promise<AuthStatus> {
    this.cancel()
    this.stopping++
    let confirmed: boolean
    try {
      confirmed = await this.exclusive(async () => {
        const revoked = !this.loadFailure && (await Promise.all(this.vault.profiles.map(profile => this.revoke(profile)))).every(Boolean)
        rmSync(this.path, { force: true })
        this.vault = freshVault()
        this.loadFailure = false
        return revoked
      })
    } catch {
      throw storageError()
    } finally {
      this.stopping--
    }
    return {
      ...this.status(),
      ...(!confirmed && { message: translate(this.locale(),
        '已删除本机凭据。未能确认远程撤销，可在 ChatGPT 设置中断开 Dr. Meow。',
        'Local credentials were deleted. You can disconnect Dr. Meow in ChatGPT settings to confirm that access has been revoked.') }),
    }
  }
}
