import { useEffect, useState } from 'react';
import type { PetState, Settings, SkinId } from '../shared/contracts.ts';
import { AccountCard, CatArtwork, WindowBar, desktop, useDesktop } from './common.tsx';
import { PetActionPreview } from './pet/PetActionPreview.tsx';
import { PetIcon } from './pet/PetIcon.tsx';
import { moodNames } from './pet/PetStatusCard.tsx';
import { moodFor } from '../shared/petCare.ts';
import { normalizePetName } from '../shared/chatCare.ts';
import type { translator } from '../shared/i18n.ts';

type Tab = 'appearance' | 'ai' | 'data';
type Wipe = 'chats' | 'pet' | 'all';

const skins: ReadonlyArray<{ id: SkinId; zh: string; en: string }> = [
  { id: 'original', zh: '奶橘原版', en: 'Original' },
  { id: 'ragdoll', zh: '布偶猫', en: 'Ragdoll' },
  { id: 'british', zh: '英国短毛猫', en: 'British Shorthair' },
  { id: 'calico', zh: '三花猫', en: 'Calico' },
];

function Toggle({ title, detail, value, set }: {
  title: string; detail?: string; value: boolean; set: (value: boolean) => void;
}) {
  return <label className="setting-row toggle-row">
    <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    <input type="checkbox" className="switch" checked={value} onChange={event => set(event.target.checked)} />
  </label>;
}

function NameSetting({ name, update, t }: {
  name: string; update(patch: Partial<Settings>): Promise<unknown>; t: ReturnType<typeof translator>;
}) {
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(name); }, [name]);
  const clean = normalizePetName(draft);
  return <section className="setting-card">
    <form onSubmit={event => {
      event.preventDefault();
      if (!clean || saving) return;
      setSaving(true); setError(false);
      void update({ petName: clean }).catch(() => setError(true)).finally(() => setSaving(false));
    }}>
      <label className="field"><strong>{t('猫咪名字', 'Cat name')}</strong>
        <input value={draft} maxLength={48} onChange={event => setDraft([...event.target.value].slice(0, 24).join(''))}
          aria-describedby="pet-name-help" />
      </label>
      <p className="muted" id="pet-name-help">{t('最多 24 个字符。聊天称呼和本地互动判断会一起使用这个名字。',
        'Up to 24 characters. Chat and local interaction detection use this name.')}</p>
      <button type="submit" className="secondary" disabled={saving || !clean || clean === name}>
        {saving ? t('保存中…', 'Saving…') : t('保存名字', 'Save name')}
      </button>
      {error && <p className="message-error" role="alert">{t('名字未保存，请重试。', 'Could not save the name. Try again.')}</p>}
    </form>
  </section>;
}

export function SettingsWindow() {
  const state = useDesktop();
  const { settings, locale, t } = state;
  const [tab, setTab] = useState<Tab>('appearance');
  const [pet, setPet] = useState<PetState>();
  const [wipe, setWipe] = useState<Wipe>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'success' | 'error'>();
  const noticeText = notice === 'success' ? t('已完成。', 'Done.')
    : notice === 'error' ? t('操作未完成，请重试。', 'Could not complete the operation. Try again.') : '';
  useEffect(() => {
    if (tab === 'data') void desktop.getPet().then(setPet);
  }, [tab]);
  async function reset() {
    if (!wipe || busy) return;
    setBusy(true);
    try {
      if (wipe === 'chats') await desktop.clearChats();
      if (wipe === 'pet') await desktop.resetPet();
      if (wipe === 'all') await desktop.clearData();
      setPet(await desktop.getPet());
      setNotice('success');
      setWipe(undefined);
    } catch {
      setNotice('error');
    } finally {
      setBusy(false);
    }
  }
  const labels: [Tab, string][] = [
    ['appearance', t('外观', 'Appearance')], ['ai', t('账号与 AI', 'Account & AI')], ['data', t('本地数据', 'Local data')],
  ];
  return <main className="shell settings-shell">
    <WindowBar subtitle={t('猫博士设置', 'Dr. Meow settings')} locale={locale} skin={settings?.skin} />
    <div className="settings-intro">
      <div><p className="eyebrow">DR. MEOW STUDIO</p><h1>{t('陪伴偏好', 'Preferences')}</h1></div>
      <label className="settings-language">
        <span>{t('语言', 'Language')}</span>
        <select aria-label={t('语言', 'Language')} value={locale} disabled={!settings}
          onChange={event => void state.update({ locale: event.target.value === 'en' ? 'en' : 'zh-CN' })}>
          <option lang="zh-CN" value="zh-CN">简体中文</option>
          <option lang="en" value="en">English</option>
        </select>
      </label>
    </div>
    <div className="tabs" aria-label={t('设置分类', 'Settings categories')}>{labels.map(([key, label]) =>
      <button key={key} className={tab === key ? 'active' : ''} type="button" aria-pressed={tab === key}
        onClick={() => { setTab(key); setNotice(undefined); }}>{label}</button>)}
    </div>
    <div className="settings-content">
      {!settings ? <p className="muted">{t('正在加载设置…', 'Loading settings…')}</p> : tab === 'appearance' ? <>
        <NameSetting name={settings.petName} update={state.update} t={t} />
        <section className="setting-card skin-card" aria-labelledby="skin-title">
          <h2 id="skin-title">{t('猫咪皮肤', 'Cat skins')}</h2>
          <p className="muted">{t('给桌面上的猫博士换个造型。', 'Choose a look for your desktop companion.')}</p>
          <div className="skin-options">
            {skins.map(({ id, zh, en }) => <button key={id} className="skin-option" data-skin={id} type="button"
              aria-pressed={settings.skin === id} onClick={() => void state.update({ skin: id })}>
              <span className="skin-preview"><CatArtwork skin={id} /></span>
              <span className="skin-name">{t(zh, en)}</span>
              <span className="skin-check" aria-hidden="true">✓</span>
            </button>)}
          </div>
        </section>
        <PetActionPreview key={settings.skin} skin={settings.skin} gentle={settings.animation === 'gentle'} t={t} />
        <section className="setting-card">
          <label className="setting-row range-row"><span><strong>{t('猫咪尺寸', 'Cat size')}</strong>
            <small>{t('随时调整桌面占用面积', 'Adjust how much space the cat takes up')}</small></span>
            <input type="range" min={180} max={360} step={5} value={settings.size}
              onChange={event => void state.update({ size: +event.target.value })} />
            <output>{Math.round(settings.size / 1.8)}%</output>
          </label>
          <label className="setting-row range-row"><span><strong>{t('透明度', 'Opacity')}</strong>
            <small>{t('让猫咪融入桌面', 'Blend the cat into your desktop')}</small></span>
            <input type="range" min={0.35} max={1} step={0.05} value={settings.opacity}
              onChange={event => void state.update({ opacity: +event.target.value })} />
            <output>{Math.round(settings.opacity * 100)}%</output>
          </label>
          <label className="setting-row"><strong>{t('动画强度', 'Motion')}</strong>
            <select value={settings.animation} onChange={event => void state.update({ animation: event.target.value === 'gentle' ? 'gentle' : 'full' })}>
              <option value="full">{t('自然', 'Full')}</option><option value="gentle">{t('轻柔', 'Gentle')}</option>
            </select>
          </label>
        </section>
        <section className="setting-card">
          <Toggle title={t('始终置顶', 'Always on top')} detail={t('让猫博士留在其他窗口上方', 'Keep Dr. Meow above other windows')}
            value={settings.alwaysOnTop} set={value => void state.update({ alwaysOnTop: value })} />
          <Toggle title={t('全屏时自动避让', 'Hide during fullscreen')}
            detail={t('猫博士会暂时离开正在全屏的显示器', 'Temporarily hide the cat on the display in fullscreen use')}
            value={settings.avoidFullscreen} set={value => void state.update({ avoidFullscreen: value })} />
          <Toggle title={t('开机启动', 'Start at sign-in')} detail={t('安装版在登录 Windows 时启动', 'Launch the installed app when you sign in to Windows')}
            value={settings.startOnLogin} set={value => void state.update({ startOnLogin: value })} />
          <Toggle title={t('安静模式', 'Quiet mode')} detail={t('保留呼吸和互动反馈，暂停自主动作', 'Keep breathing and reactions, pause spontaneous actions')}
            value={settings.quiet} set={value => void state.update({ quiet: value })} />
        </section>
      </> : tab === 'ai' ? <>
        <AccountCard state={state} />
        <section className="setting-card">
          <label className="setting-row"><strong>{t('默认模型', 'Default model')}</strong>
            <select value={state.models.some(model => model.id === settings.model) ? settings.model : ''}
              onChange={event => void state.update({ model: event.target.value })}>
              <option value="">{t('使用账号默认模型', 'Use account default')}</option>
              {state.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          {state.modelError && <p className="muted">{state.modelError}{' '}
            <button className="text-button" onClick={() => void state.refreshModels()}>{t('重试', 'Retry')}</button>
          </p>}
          <label className="setting-row"><strong>{t('猫咪语气', 'Tone')}</strong><select value={settings.tone}
            onChange={event => void state.update({ tone: event.target.value as typeof settings.tone })}>
            <option value="normal">{t('正常', 'Normal')}</option><option value="cute">{t('可爱', 'Playful')}</option>
            <option value="professional">{t('专业', 'Professional')}</option>
          </select></label>
          <label className="setting-row"><strong>{t('回答长度', 'Reply length')}</strong><select value={settings.length}
            onChange={event => void state.update({ length: event.target.value as typeof settings.length })}>
            <option value="short">{t('简短', 'Short')}</option><option value="standard">{t('标准', 'Standard')}</option>
            <option value="detailed">{t('详细', 'Detailed')}</option>
          </select></label>
        </section>
      </> : <>
        <section className="setting-card">
          <h2>{t('猫博士近况', 'How Dr. Meow is doing')}</h2>
          {pet && <div className="pet-icon-row pet-preview-transport" role="group" aria-label={t('猫咪状态', 'Cat status')}>
            {([['bowl', 'fullness', '饱食度', 'Fullness'], ['heart', 'affection', '亲密度', 'Affection']] as const)
              .map(([icon, key, zh, en]) => {
                const label = t(zh, en) + ' · ' + Math.round(pet[key]);
                return <span key={key} className="pet-icon-button pet-indicator" role="img" tabIndex={0}
                  title={label} aria-label={label} data-hint={label}><PetIcon name={icon} level={Math.ceil(pet[key] / 25)} /></span>;
              })}
            <span className="pet-icon-button pet-indicator" role="img" tabIndex={0}
              title={t(...moodNames[moodFor(pet)])} aria-label={t(...moodNames[moodFor(pet)])}
              data-hint={t(...moodNames[moodFor(pet)])}><PetIcon name="mood" mood={moodFor(pet)} /></span>
          </div>}
        </section>
        <section className="setting-card">
          <h2>{t('隐私与历史', 'Privacy and history')}</h2>
          <p className="muted">{t('对话、宠物和偏好保存在这台电脑。发送问题时，会把当前对话中相关的近期消息交给 OpenAI。Windows 加密保护登录凭据。',
            'Your chats, pet data, and preferences are stored on this PC. When you ask a question, relevant recent messages from that chat are sent to OpenAI. Windows encrypts your sign-in credentials.')}</p>
          <div className="data-buttons">
            <button className="secondary" onClick={() => desktop.openChat()}>{t('打开聊天记录', 'Open chat history')}</button>
            <button className="secondary" onClick={() => { setNotice(undefined); setWipe('pet'); }}>{t('重置宠物状态', 'Reset pet stats')}</button>
            <button className="secondary" onClick={() => { setNotice(undefined); setWipe('chats'); }}>{t('清空聊天记录', 'Clear chat history')}</button>
            <button className="danger" onClick={() => { setNotice(undefined); setWipe('all'); }}>{t('清除全部本地数据', 'Clear all local data')}</button>
          </div>
          {noticeText && <p role="status">{noticeText}</p>}
          {state.auth.state === 'signed-out' && state.auth.message && <p className="muted">{state.auth.message}</p>}
        </section>
      </>}
    </div>
    {wipe && <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="wipe-title">
      <h2 id="wipe-title">{wipe === 'all' ? t('清除全部本地数据？', 'Clear all local data?')
        : wipe === 'chats' ? t('清空所有聊天记录？', 'Clear all chat history?') : t('重置宠物状态？', 'Reset pet stats?')}</h2>
      <p>{wipe === 'all' ? t('这会清除对话、宠物、偏好和此应用保存的账号授权。', 'This clears chats, pet data, preferences, and account authorizations saved by the app.')
        : wipe === 'chats' ? t('这台电脑上的 Dr. Meow 对话将被删除。', 'This deletes the Dr. Meow chats stored on this PC.')
          : t('饱食度、心情和亲密度将恢复初始值。', 'Fullness, mood, and affection will return to their starting values.')}</p>
      {noticeText && <p role="alert">{noticeText}</p>}
      <div className="data-buttons">
        <button className="secondary" disabled={busy} onClick={() => setWipe(undefined)}>{t('取消', 'Cancel')}</button>
        <button className="danger" disabled={busy} onClick={() => void reset()}>
          {busy ? t('处理中…', 'Working…') : t('确认', 'Confirm')}
        </button>
      </div>
    </div></div>}
  </main>;
}

