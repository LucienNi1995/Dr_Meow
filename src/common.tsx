import { useEffect, useState } from 'react';
import type { AuthStatus, Model, Settings, SignInOptions, SkinId } from '../shared/contracts.ts';
import type { Locale } from '../shared/i18n.ts';
import { translate, translator } from '../shared/i18n.ts';
import { skinPortrait } from './pet/portrait.ts';

export const desktop = window.meow;

export function CatArtwork({ skin = 'original' }: { skin?: SkinId }) {
  return <span className="cat-art" aria-hidden="true">
    <img className="cat-art-portrait" src={skinPortrait(skin)} alt="" draggable={false} />
  </span>;
}

export function Avatar({ size = 35, skin }: { size?: number; skin?: SkinId }) {
  return <div className="avatar" style={{ width: size, height: size }} aria-hidden="true">
    <CatArtwork skin={skin} />
  </div>;
}

export function WindowBar({ subtitle, settings, locale, skin, name, onLanguageChange }: {
  subtitle: string; settings?: boolean; locale?: Locale; skin?: SkinId; name?: string; onLanguageChange?: () => void;
}) {
  const t = translator(locale);
  const changeLanguage = t('Switch to English', '切换至简体中文');
  return <header className="titlebar">
    <Avatar skin={skin} />
    <div className="titlebar-label"><strong>{name || 'Dr. Meow'}</strong><small>{subtitle}</small></div>
    <div className="window-buttons">
      {onLanguageChange && <button className="icon" type="button" onClick={onLanguageChange}
        aria-label={changeLanguage} title={changeLanguage} lang={locale === 'en' ? 'zh-CN' : 'en'}>{t('EN', '中')}</button>}
      {settings && <button className="icon" type="button" onClick={() => desktop.openSettings()}
        aria-label={t('设置', 'Settings')} title={t('设置', 'Settings')}>⚙</button>}
      <button className="icon" type="button" onClick={() => desktop.minimizePanel()}
        aria-label={t('最小化', 'Minimize')} title={t('最小化', 'Minimize')}>−</button>
      <button className="icon close" type="button" onClick={() => desktop.closePanel()}
        aria-label={t('关闭', 'Close')} title={t('关闭', 'Close')}>×</button>
    </div>
  </header>;
}

const statusLabels: Record<AuthStatus['state'], [string, string]> = {
  'signed-out': ['陪伴模式 · 未登录', 'Pet mode · Signed out'],
  'identity-only': ['已登录 · 待授权套餐', 'Signed in · Plan access pending'],
  connected: ['已连接 ChatGPT', 'Connected to ChatGPT'],
  expired: ['登录已过期', 'Sign-in expired'],
  ineligible: ['账号或工作区权限不足', 'Account or workspace ineligible'],
  network: ['网络连接失败', 'Connection failed'],
  denied: ['授权已取消', 'Authorization cancelled'],
  limited: ['已达到套餐用量限制', 'Plan usage limit reached'],
  error: ['登录遇到问题', 'Sign-in issue'],
};

export function statusLabel(state: AuthStatus['state'], locale?: Locale) {
  return translate(locale, ...statusLabels[state]);
}

export function useDesktop() {
  const [settings, setSettings] = useState<Settings>();
  const [auth, setAuth] = useState<AuthStatus>({ state: 'signed-out' });
  const [models, setModels] = useState<Model[]>([]);
  const [modelError, setModelError] = useState(false);
  const [signing, setSigning] = useState(false);
  const locale = settings?.locale ?? 'zh-CN';
  const t = translator(locale);
  useEffect(() => {
    const unSettings = desktop.onSettings(setSettings);
    const unAuth = desktop.onAuth(setAuth);
    void desktop.getSettings().then(setSettings);
    void desktop.getAuth().then(setAuth);
    return () => { unSettings(); unAuth(); };
  }, []);
  const accountId = auth.account?.id;
  const canGetModels = auth.state === 'connected' || auth.state === 'expired' ||
    auth.state === 'limited' || auth.state === 'network';
  useEffect(() => {
    let current = true;
    setModels([]);
    setModelError(false);
    if (accountId && canGetModels) {
      void desktop.getModels().then(next => {
        if (current) setModels(next);
      }).catch(() => {
        if (current) setModelError(true);
      });
    }
    return () => { current = false; };
  }, [accountId, canGetModels]);
  async function signIn(options?: SignInOptions) {
    setSigning(true);
    try {
      setAuth(await desktop.signIn(options));
    } catch {
      setAuth(current => ({ ...current, state: 'error',
        message: t('无法启动授权。请稍后再试。', 'Could not start sign-in. Try again in a moment.') }));
    } finally {
      setSigning(false);
    }
  }
  async function update(patch: Partial<Settings>) {
    setSettings(await desktop.updateSettings(patch));
  }
  async function refreshModels() {
    setModelError(false);
    try { setModels(await desktop.getModels()); }
    catch { setModelError(true); }
  }
  return {
    settings, locale, t, auth, models, signing, signIn, update, refreshModels,
    modelError: modelError ? t('无法加载模型，请检查连接后重试。', 'Could not load models. Check your connection and try again.') : '',
    signOut: async () => setAuth(await desktop.signOut())
  };
}

export type DesktopState = ReturnType<typeof useDesktop>;

export function Usage({ auth, locale }: { auth: AuthStatus; locale?: Locale }) {
  const t = translator(locale);
  if (auth.state !== 'connected' && auth.state !== 'limited') return null;
  return <div className="usage-line"><span><i />{auth.state === 'limited' ? t('ChatGPT 用量已达上限', 'ChatGPT usage limit reached') : 'Using ChatGPT plan'}</span>
    <div className="usage-actions">
      <button className="text-button" type="button" onClick={() => desktop.openUsage()}>Manage usage ↗</button>
      {auth.state === 'limited' && <button className="text-button" type="button" onClick={() => void desktop.resumeUsage()}>{t('恢复请求', 'Resume requests')}</button>}
    </div>
  </div>;
}

export function AccountCard({ state, compact }: { state: DesktopState; compact?: boolean }) {
  const { auth, signing, signIn, signOut, locale, t } = state;
  const canSignIn = auth.state !== 'connected' && auth.state !== 'limited';
  return <div className={compact ? 'account-card compact' : 'account-card'}>
    <div className="account-status"><span className={auth.state === 'connected' ? 'status-dot green' : 'status-dot'} />
      <strong>{statusLabel(auth.state, locale)}</strong></div>
    {auth.account && <p className="account-name">{auth.account.email ?? auth.account.name ?? t('ChatGPT 账号', 'ChatGPT account')}</p>}
    {auth.message && <p className="muted">{auth.message}</p>}
    {auth.state === 'identity-only' && <p className="muted">{t('在浏览器授权套餐使用权限，即可用符合条件的 ChatGPT 套餐聊天。', 'Authorize plan access in your browser to chat using your eligible ChatGPT plan.')}</p>}
    {auth.state === 'signed-out' && !compact && <p className="muted">{t('符合资格的请求可使用你自己的 ChatGPT 套餐或可用额度。', 'Eligible requests can use your ChatGPT plan or available credits.')}</p>}
    {auth.state === 'ineligible' && <p className="muted">{t('请检查套餐资格及工作区设置，或切换账号。', 'Check your plan and workspace settings or switch accounts.')}</p>}
    {auth.state === 'expired' && <p className="muted">{t('如自动刷新失败，请重新登录。', 'Sign in again if your session cannot renew automatically.')}</p>}
    {signing ? <div className="account-actions">
      <span role="status">{t('请在系统浏览器完成授权…', 'Complete sign-in in your browser…')}</span>
      <button type="button" className="secondary" onClick={() => desktop.cancelSignIn()}>{t('取消', 'Cancel')}</button>
    </div> : <div className="account-actions">
      {canSignIn && <button type="button" className="chatgpt-button" data-oai-siwc-button=""
        onClick={() => void signIn({ reconsent: auth.state === 'identity-only' })}>
        <img alt="" src={import.meta.env.BASE_URL + 'assets/chatgpt-logo.svg'} />Continue with ChatGPT
      </button>}
      {!compact && auth.account && <button type="button" className="secondary" onClick={() => void signOut()}>{t('注销', 'Sign out')}</button>}
      {!compact && auth.account && <button type="button" className="text-button" onClick={() => void signIn({ addAccount: true })}>{t('添加账号', 'Add account')}</button>}
    </div>}
    {!compact && !signing && !!auth.accounts?.length && <div className="saved-accounts">
      {auth.accounts.filter(account => account.id !== auth.account?.id).map(account =>
        <button className="text-button" key={account.id} onClick={() => void signIn({ accountId: account.id })}>
          {account.email ?? account.name ?? t('已保存账号', 'Saved account')} ↗
        </button>)}
    </div>}
    {!compact && <Usage auth={auth} locale={locale} />}
  </div>;
}

