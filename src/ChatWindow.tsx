import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatSendInput, Conversation, Message, PetState, SkinId } from '../shared/contracts.ts';
import type { translator } from '../shared/i18n.ts';
import { AccountCard, Avatar, Usage, WindowBar, desktop, statusLabel, useDesktop } from './common.tsx';
import './chat-theme.css';
import { careReason, petName } from '../shared/chatCare.ts';
import { ChatCare } from './ChatCare.tsx';
import { PetIcon } from './pet/PetIcon.tsx';

const errors = {
  history: ['无法读取本地对话。', 'Could not read local chats.'],
  send: ['发送失败，请重试。', 'Could not send the message. Try again.'],
  newChat: ['无法创建对话。', 'Could not start a new chat.'],
  language: ['无法保存语言设置。', 'Could not save the language setting.'],
} as const;

const noMessages: readonly Message[] = [];

function ChatDecoration({ skin }: { skin: SkinId }) {
  const marks = {
    original: <>
      <path className="chat-ornament-fill" d="M14 7a1.5 1.5 0 0 1 3 0c3 1 4 3.5 4 6v2l2 3H8l2-3v-2c0-2.5 1-5 4-6Z" />
      <path d="M9 18h13m-8 2a1.6 1.6 0 0 0 3 0" />
      <path className="chat-ornament-accent" d="M31 8c-2.5-1-2.5-3.5-.9-4.1 1.7-.6 2.7 1.6 2.1 3 .4-2.3 2.4-3.2 3.4-2 1 1.3-.2 3.4-2 3.9.4.7 1.6.9 1.7 2.1.2 2.5-6.9 1.4-6.3-.9.2-.9 1.3-1 2-2Z" />
    </>,
    ragdoll: <>
      <path className="chat-ornament-fill" d="M8.4 16a7 7 0 1 1 13.1 0c-1.1 2.4-3.5 4-6.6 4-2.7 0-5.4-1.2-6.5-4Z" />
      <path d="M9 11c3.7.1 7.3 2.7 9.2 6.7M12.7 7.5c3 .8 6.5 3.4 8.7 6.8M18.1 19.3c2.5 2.1 5.4 2.7 7.8 1.1" />
      <path className="chat-ornament-accent" d="M33 4c.5 3.2 1.7 4.2 4 4.7-2.3.4-3.5 1.4-4 4.6-.5-3.2-1.7-4.2-4-4.6C31.3 8.2 32.5 7.2 33 4Z" />
    </>,
    british: <>
      <circle className="chat-ornament-fill" cx="15" cy="13" r="8.2" />
      <path className="chat-ornament-accent" d="M15 12c-1.2 0-3.7 2.4-3.5 3.5.1 1 1.8 1.8 3.5.9 1.7.9 3.4.1 3.5-.9.2-1.1-2.3-3.5-3.5-3.5Z" />
      <path d="M11.4 11.7h.1m2-2.2h.1m2.8 0h.1m2 2.2h.1m10.5 3.8h.1m3.9-7.1h.1m2.9 4h.1" strokeWidth="2" />
    </>,
    calico: <>
      <path className="chat-ornament-fill" d="M9 14c.7-1.5 2.8-1.7 3.7-3.1.8-1.4 0-3.5 2.2-4.3 2.5-.9 5.8 2.2 6 4.9.2 2.3-2.3 3.1-3.5 5.3-1.5 2.6-3.4 3.5-5.9 2.6-2.8-1-3.4-3.8-2.5-5.4Z" />
      <path className="chat-ornament-accent" d="M20.7 8.8c2.9-.5 4.9.8 4.9 2.5 0 2-2.8 1.2-3.6 2.5-.8 1.4 1 2.6.6 4.1-.5 1.6-4.1 2.2-5.9 1.3 1.7-2 2-3.1 3.1-4.5 1.3-1.7 1.5-3.3.9-5.9Z" />
      <path d="M31 12c1.2-1.7 4.1-2.4 4.8-.7.7 1.6-1.3 3.4-3.7 3.4" strokeWidth="2" />
    </>,
  };
  return <svg className="chat-ornament" viewBox="0 0 44 26" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">{marks[skin]}</g>
  </svg>;
}

function MessageBubble({ message, t, name }: { message: Message; t: ReturnType<typeof translator>; name: string }) {
  const [copied, setCopied] = useState(false);
  const assistant = message.role === 'assistant';
  return <article className={'bubble ' + (assistant ? 'assistant' : 'user')}>
    <div className="message-label">{assistant ? name : t('你', 'You')}</div>
    {assistant ? <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => href && /^https?:\/\//i.test(href)
            ? <button className="text-button link-inline" type="button" onClick={() => desktop.openLink(href)}>{children} ↗</button>
            : <span>{children}</span>
        }}>{message.text}</Markdown>
      {message.status === 'streaming' && <span className="thinking" aria-label={t('正在回复', 'Replying')}>
        {message.text ? '▍' : t(name + '正在思考…', name + ' is thinking…')}
      </span>}
    </div> : <p className="user-text">{message.text}</p>}
    {message.search === 'used' && <div className="search-label">◎ {t('已使用联网搜索', 'Web search used')}</div>}
    {message.search === 'unavailable' && !message.error && <div className="search-label warning">
      {t('当前账号或模型暂不支持联网搜索。', 'Web search is unavailable for this account or model.')}
    </div>}
    {!!message.sources?.length && <div className="source-list" aria-label={t('引用来源', 'Sources')}>
      {message.sources.map((source, index) => {
        const hostname = new URL(source.url).hostname.replace(/^www\./, '');
        return <button type="button" className="source-card" key={source.url} onClick={() => desktop.openLink(source.url)}>
          <span className="source-index">{index + 1}</span>
          <span><strong>{source.title}</strong><small>{hostname}{source.date ? ' · ' + source.date : ''}</small></span><span aria-hidden>↗</span>
        </button>;
      })}
    </div>}
    {message.status === 'cancelled' && <p className="muted">{t('已停止生成。', 'Reply stopped.')}</p>}
    {message.error && <p className="message-error" role="status">{message.error}</p>}
    {message.petEffect && <div className="message-pet-effect" aria-label={t('本轮状态变化', 'Pet changes this turn')}>
      {([['fullness', 'bowl', '饱食度', 'Fullness'], ['mood', 'mood', '心情', 'Mood'],
        ['affection', 'heart', '亲密度', 'Affection']] as const).map(([key, icon, zh, en]) => {
        const value = message.petEffect?.[key] ?? 0;
        return <span key={key} title={t(zh, en)}><PetIcon name={icon} />{value > 0 ? '+' : ''}{value}</span>;
      })}
    </div>}
    {message.diagnostic && <details className="request-detail">
      <summary>{t('请求诊断', 'Request details')}</summary>
      <code>{message.diagnostic}</code>
      <button className="text-button" type="button" onClick={() => desktop.copyText(message.diagnostic!)}>
        {t('复制诊断信息', 'Copy request details')}
      </button>
    </details>}
    {assistant && !!message.text && message.status !== 'streaming' &&
      <button className="text-button copy" type="button" onClick={() => {
        desktop.copyText(message.text);
        setCopied(true);
      }}>{copied ? t('已复制 ✓', 'Copied ✓') : t('复制回答', 'Copy reply')}</button>}
  </article>;
}

export function ChatWindow() {
  const state = useDesktop();
  const { locale, t } = state;
  const skin = state.settings?.skin ?? 'original';
  const [chats, setChats] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [pet, setPet] = useState<PetState>();
  const [blocked, setBlocked] = useState<ChatSendInput>();
  const [dismissedHint, setDismissedHint] = useState(0);
  const name = petName(state.settings?.petName);
  const petVersion = useRef(0);
  const [showHistory, setShowHistory] = useState(false);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [error, setError] = useState<keyof typeof errors>();
  const errorText = error && errors[error];
  const [planWelcome, setPlanWelcome] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const chat = chats.find(item => item.id === selected);
  const messages = chat?.messages ?? noMessages;
  const last = messages.at(-1);
  const model = state.models.some(entry => entry.id === state.settings?.model)
    ? state.settings?.model ?? '' : state.models[0]?.id ?? '';
  const streaming = sending || chats.some(item => item.messages.at(-1)?.status === 'streaming');
  const refresh = useCallback(async () => {
    const next = await desktop.listChats();
    setChats(next);
    setSelected(id => next.some(item => item.id === id) ? id : next[0]?.id ?? '');
  }, []);

  useEffect(() => {
    let mounted = true;
    async function refreshPet() {
      const version = petVersion.current;
      const value = await desktop.getPet().catch(() => undefined);
      if (mounted && value && version === petVersion.current) setPet(value);
    }
    const unPet = desktop.onPetState(value => {
      petVersion.current++;
      setPet(value);
    });
    const focused = () => { void refreshPet(); };
    window.addEventListener('focus', focused);
    void refreshPet();
    const unHistory = desktop.onHistory(() => { void refresh(); });
    const unSearch = desktop.onSearchMode(enabled => { setSearch(enabled); composer.current?.focus(); });
    const unChat = desktop.onChat(({ conversationId, message }) => {
      setChats(current => current.map(item => {
        if (item.id !== conversationId) return item;
        const found = item.messages.some(existing => existing.id === message.id);
        const next = found ? item.messages.map(existing => existing.id === message.id ? message : existing)
          : [...item.messages, message];
        return { ...item, messages: next };
      }));
    });
    void refresh().catch(() => setError('history'));
    return () => {
      mounted = false;
      unPet(); unHistory(); unSearch(); unChat();
      window.removeEventListener('focus', focused);
    };
  }, [refresh]);

  useEffect(() => { setBlocked(undefined); }, [selected]);

  useEffect(() => {
    if (state.auth.state === 'connected' && !localStorage.getItem('plan-welcome')) setPlanWelcome(true);
    if (!state.auth.account) setPlanWelcome(false);
  }, [state.auth.state, state.auth.account]);
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);

  async function createChat() {
    const created = await desktop.newChat();
    setChats(current => current.some(item => item.id === created.id) ? current : [created, ...current]);
    setSelected(created.id);
    follow.current = true;
    return created.id;
  }

  async function send(retry = false, searchMode = search, recover = false) {
    const pending = recover && blocked?.id === selected ? blocked : undefined;
    if (pending) { retry = pending.retry === true; searchMode = pending.search; }
    const text = pending?.text ?? draft.trim();
    if (streaming || (!retry && !text)) return;
    setSending(true);
    setError(undefined);
    follow.current = true;
    try {
      const id = pending?.id ?? (selected || await createChat());
      if (!retry) setDraft('');
      const input = { id, text, model: pending?.model ?? model, search: searchMode, retry, recover };
      const result = await desktop.sendChat(input);
      if (result.status === 'care-required') {
        setPet(result.pet);
        setBlocked(input);
        if (!retry) setDraft(current => current || text);
      } else {
        setBlocked(undefined);
      }
    } catch {
      if (!retry) setDraft(text);
      setError('send');
    } finally {
      setSending(false);
      await refresh().catch(() => {});
      composer.current?.focus();
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }
  const query = filter.trim().toLocaleLowerCase();
  const matching = chats.filter(item => !query || item.title.toLocaleLowerCase().includes(query) ||
    item.messages.some(message => message.text.toLocaleLowerCase().includes(query)));
  const disconnected = state.auth.state !== 'connected' && state.auth.state !== 'limited';
  return <main className="shell chat-shell" data-skin={skin}>
    <div className="chat-heading">
      <WindowBar subtitle={statusLabel(state.auth.state, locale)} settings locale={locale} skin={skin} name={name}
        onLanguageChange={() => { void state.update({ locale: locale === 'en' ? 'zh-CN' : 'en' }).catch(() => setError('language')); }} />
      <ChatDecoration skin={skin} />
    </div>
    <div className="chat-tools">
      <button type="button" className={'pill' + (showHistory ? ' active' : '')} aria-expanded={showHistory}
        onClick={() => setShowHistory(open => !open)}>☰ {t('本地记录', 'History')}</button>
      <span className="current-title" title={chat?.title}>{chat?.title ?? t('知识工作台', 'Workspace')}</span>
      <button type="button" className="pill" disabled={streaming} onClick={() => {
        void createChat().then(() => { setShowHistory(false); composer.current?.focus(); })
          .catch(() => setError('newChat'));
      }}>＋ {t('新对话', 'New chat')}</button>
    </div>
    {showHistory && <section className="history" aria-label={t('本地聊天历史', 'Local chat history')}>
      <label className="field"><span>{t('搜索本地记录', 'Search history')}</span><input type="search" value={filter}
        placeholder={t('标题或消息内容', 'Chat title or message')}
        onChange={event => setFilter(event.target.value)} /></label>
      <div className="history-list">
        {!matching.length && <p className="muted">{t('没有匹配的对话。', 'No matching chats.')}</p>}
        {matching.map(item => <div className={'history-item' + (item.id === selected ? ' selected' : '')} key={item.id}>
          {editing === item.id ? <form onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!newTitle.trim()) return;
            void desktop.renameChat(item.id, newTitle).then(() => setEditing(''));
          }}>
            <input aria-label={t('对话名称', 'Chat name')} autoFocus value={newTitle} maxLength={120}
              onChange={event => setNewTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditing(''); }} />
            <button className="pill" type="submit">{t('保存', 'Save')}</button>
          </form> : deleteId === item.id ? <div className="history-delete">
            <span>{t('删除这段对话？', 'Delete this chat?')}</span>
            <button className="text-button" onClick={() => setDeleteId('')}>{t('取消', 'Cancel')}</button>
            <button className="danger" onClick={() => void desktop.deleteChat(item.id).then(() => setDeleteId(''))}>{t('删除', 'Delete')}</button>
          </div> : <>
            <button type="button" className="history-title" onClick={() => {
              follow.current = true; setSelected(item.id); setShowHistory(false);
            }}>{item.title}<small>{new Date(item.updatedAt).toLocaleDateString(locale)}</small></button>
            <button type="button" className="icon" aria-label={t('重命名', 'Rename')}
              onClick={() => { setEditing(item.id); setNewTitle(item.title); }}>✎</button>
            <button type="button" className="icon" aria-label={t('删除对话', 'Delete chat')} onClick={() => setDeleteId(item.id)}>×</button>
          </>}
        </div>)}
      </div>
    </section>}
    <div className="chat-content" ref={list} onScroll={() => {
      const element = list.current;
      if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 65;
    }}>
      {!messages.length ? <div className="welcome">
        <div className="welcome-avatar"><Avatar size={68} skin={skin} /><ChatDecoration skin={skin} /></div>
        <p className="eyebrow">{t(name + '的知识工作台', name + '’s workspace')}</p>
        <h1>{t('今天想弄懂什么？', 'What are you curious about today?')}</h1>
        <p className="muted">{t('带一个问题来，' + name + '陪你慢慢想。', 'Bring a question and we’ll think it through together.')}</p>
        {disconnected ? <AccountCard state={state} compact /> : <div className="suggestions">
          <button className="pill" onClick={() => { setDraft(t('为什么天空是蓝色的？', 'Why is the sky blue?')); composer.current?.focus(); }}>
            {t('为什么天空是蓝色的？', 'Why is the sky blue?')}
          </button>
          <button className="pill" onClick={() => {
            setDraft(t('帮我整理今天的 AI 新闻。', 'Summarize today’s AI news.')); setSearch(true); composer.current?.focus();
          }}>{t('今天的 AI 新闻', 'Today’s AI news')}</button>
        </div>}
      </div> : <>
        {disconnected && <AccountCard state={state} compact />}
        {messages.map(message => <MessageBubble message={message} t={t} name={name} key={message.id} />)}
      </>}
      {!streaming && last?.role === 'assistant' && (last.status === 'error' || last.status === 'cancelled') &&
        <button type="button" className="pill retry" onClick={() => void send(true, last.search === 'unavailable' ? false : search)}>
          {last.search === 'unavailable' ? t('用普通问答重试', 'Retry without search') : t('重试这条消息', 'Retry message')}
        </button>}
    </div>
    <footer className="composer">
      <ChatCare pet={pet} settings={state.settings} t={t} />
      {pet && careReason(pet) && <div className="chat-care-required" role="status">
        <span>{careReason(pet) === 'fullness' ? t(name + '想吃点东西，照料后就能继续。', name + ' would like a snack before continuing.')
          : careReason(pet) === 'mood' ? t(name + '想被安慰一下，照料后就能继续。', name + ' would like some comfort before continuing.')
            : t(name + '想和你亲近一下，照料后就能继续。', name + ' would like a little care before continuing.')}</span>
        <button className="primary" type="button" disabled={streaming || (!draft.trim() && !blocked?.retry)}
          onClick={() => void send(false, search, true)}>{t('照料并继续', 'Care and continue')}</button>
      </div>}
      {pet?.careHintAt && pet.careHintAt !== dismissedHint && !careReason(pet) && <div className="chat-care-hint" role="status">
        <span>{t('聊了好多啦，可以摸摸或喂一下' + name + '。', 'A little petting or a snack for ' + name + ' would be lovely.')}</span>
        <button className="text-button" onClick={() => setDismissedHint(pet.careHintAt!)}>{t('知道了', 'Got it')}</button>
      </div>}
      <Usage auth={state.auth} locale={locale} />
      {state.modelError && <div className="muted">{state.modelError}{' '}
        <button className="text-button" onClick={() => void state.refreshModels()}>{t('重试', 'Retry')}</button>
      </div>}
      {errorText && <div className="message-error" role="alert">{t(errorText[0], errorText[1])}</div>}
      <div className="composer-controls">
        <button type="button" className={'pill' + (search ? ' active' : '')} aria-pressed={search}
          onClick={() => setSearch(on => !on)}>◎ {t('联网搜索', 'Web search')}</button>
        <select aria-label={t('模型', 'Model')} disabled={!model || streaming} value={model}
          onChange={event => void state.update({ model: event.target.value })}>
          {!model && <option value="">{t('模型未连接', 'No model connected')}</option>}
          {state.models.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </div>
      <div className="compose-box">
        <textarea ref={composer} rows={2} value={draft} maxLength={16_000}
          onChange={event => { setDraft(event.target.value); setBlocked(undefined); }} onKeyDown={keyDown}
          aria-label={t('输入消息', 'Message')} placeholder={t('问' + name + '一个问题…', 'Ask ' + name + ' a question…')} />
        {streaming ? <button className="send" type="button" aria-label={t('停止生成', 'Stop reply')} title={t('停止生成', 'Stop reply')}
          onClick={() => desktop.cancelChat()}>■</button>
          : <button className="send" type="button" aria-label={t('发送消息', 'Send message')} title={t('发送消息', 'Send message')}
            disabled={!draft.trim()} onClick={() => void send()}>↑</button>}
      </div>
    </footer>
    {planWelcome && <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <p className="eyebrow">CHATGPT</p><h2 id="plan-title">{t('已启用 ChatGPT 套餐', 'Your ChatGPT plan is connected')}</h2>
        <p>{t('符合条件的 AI 请求将计入你的 ChatGPT 套餐。你可以在 ChatGPT 设置里查看和管理用量。',
          'Eligible requests use your ChatGPT plan. You can review and manage usage in ChatGPT settings.')}</p>
        <Usage auth={state.auth} locale={locale} />
        <button type="button" className="primary" autoFocus onClick={() => {
          localStorage.setItem('plan-welcome', '1');
          setPlanWelcome(false);
        }}>{t('知道了', 'Got it')}</button>
      </div>
    </div>}
  </main>;
}

