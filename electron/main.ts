import { translate, translator } from '../shared/i18n.ts';
import { app, clipboard, ipcMain, powerMonitor, safeStorage, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AuthStatus, ChatSendInput, ChatSendResult, Message, Model, PetAction, QuotaState, Settings, SignInOptions, WindowKind
} from '../shared/contracts.ts';
import { AiError, AiService } from './ai/responsesClient.ts';
import { AuthError, AuthService } from './auth/siwcClient.ts';
import { chatgptUsageUrl } from '../shared/contracts.ts';
import { careContacts, moodFor } from '../shared/petCare.ts';
import { careReason, petName } from '../shared/chatCare.ts';
import { applyPetAction, LocalDatabase, petAtTime, sanitizeSettings } from './database.ts';
import { DesktopWindows } from './windows.ts';

app.setName('Dr. Meow');
app.setAppUserModelId('org.drmeow.desktop');
class UserMessageError extends Error {}

const smoke = process.argv.includes('--desktop-smoke');
if (smoke) {
  const profile = join(app.getPath('temp'), 'dr-meow-smoke-' + randomUUID());
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  void app.whenReady().then(launch).catch(error => {
    console.error('Dr. Meow startup failed', error instanceof Error ? error.name + ': ' + error.message : 'Unknown');
    app.exit(1);
  });
}

function launch() {
  const development = !app.isPackaged && process.env.DR_MEOW_DEV === '1';
  const csp = [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self'",
    development ? "connect-src 'self' ws://127.0.0.1:4177" : "connect-src 'none'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());

  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const db = new LocalDatabase(join(userData, 'dr-meow.sqlite'));
  const locale = () => db.settings().locale;
  const t = (chinese: string, english: string) => translate(locale(), chinese, english);
  const auth = new AuthService(userData, url => shell.openExternal(url), safeStorage, undefined, locale);
  const ai = new AiService(forceRefresh => auth.accessToken(forceRefresh));
  let quitting = false;
  let modelCache: { account: string; models: Model[]; expires: number } | undefined;
  let active: { id: string; controller: AbortController; finished?: Promise<ChatSendResult> } | undefined;
  let serviceStatus: AuthStatus['state'] | undefined;
  let petAt = -Infinity;
  let pendingCare: { id: string; action: PetAction; source: 'pet' | 'chat'; contactAt: number; expiresAt: number } | undefined;
  let signInBusy = false;
  let authGeneration = 0;
  let resetting = false;
  const desktop = new DesktopWindows(db, () => quitting, !smoke);
  const all: WindowKind[] = ['pet', 'chat', 'settings'];
  const accountWindows: WindowKind[] = ['chat', 'settings'];
  const chat: WindowKind[] = ['chat'];
  const pet: WindowKind[] = ['pet'];
  const settings: WindowKind[] = ['settings'];
  function handle<T extends unknown[]>(channel: string, kinds: WindowKind[], fn: (...args: T) => unknown) {
    ipcMain.handle(channel, (event, ...args: T) => {
      if (!desktop.owns(event, kinds)) throw new Error(t('操作不可用。', 'This action is unavailable.'));
      return fn(...args);
    });
  }
  function listen<T extends unknown[]>(channel: string, kinds: WindowKind[], fn: (event: Electron.IpcMainEvent, ...args: T) => void) {
    ipcMain.on(channel, (event, ...args: T) => {
      if (desktop.owns(event, kinds)) fn(event, ...args);
    });
  }

  function authStatus(): AuthStatus {
    const value = auth.status();
    return serviceStatus && value.state === 'connected' ? { ...value, state: serviceStatus } : value;
  }
  function quotaState(value = authStatus()): QuotaState {
    if (value.state === 'limited') return 'limited';
    return auth.status().state === 'connected' ? 'view' : 'connect';
  }

  function publishAuth(value = authStatus()) {
    for (const kind of accountWindows) desktop.emit(kind, 'auth:status', value);
    desktop.emit('pet', 'quota:changed', quotaState(value));
  }
  function historyChanged() { desktop.emit('chat', 'chat:history'); }
  function animateError(error: unknown) {
    desktop.animate('error');
    const code = error instanceof AuthError || error instanceof AiError ? error.code : undefined;
    if (code === 'expired' || code === 'network' || code === 'ineligible') serviceStatus = code;
    if (code === 'permission') serviceStatus = 'ineligible';
    if (code === 'limit') serviceStatus = 'limited';
    if (serviceStatus || error instanceof AuthError) publishAuth();
  }

  async function models(): Promise<Model[]> {
    const generation = authGeneration;
    const profile = auth.status();
    const id = profile.account?.id;
    if (!id || (profile.state !== 'connected' && profile.state !== 'expired')) return [];
    if (modelCache && modelCache.account === id && modelCache.expires > Date.now()) return modelCache.models;
    try {
      const result = await ai.models();
      if (generation !== authGeneration || auth.status().account?.id !== id) return [];
      modelCache = { account: id, models: result, expires: Date.now() + 300_000 };
      if (serviceStatus && serviceStatus !== 'limited') {
        serviceStatus = undefined;
        publishAuth();
      }
      return result;
    } catch (error) {
      if (generation !== authGeneration) return [];
      animateError(error);
      throw error;
    }
  }

  function publicError(error: unknown): string {
    if (error instanceof AuthError || error instanceof AiError) return error.localized(locale());
    return t('操作暂时无法完成。请稍后重试。', 'Something went wrong. Please try again.');
  }

  function commitPetAction(action: PetAction) {
    const now = Date.now();
    const saved = db.pet();
    const before = petAtTime(saved, now);
    const state = applyPetAction(saved, action, now);
    db.savePet(state);
    desktop.broadcast('pet:state', state, {
      fullness: Math.max(0, state.fullness - before.fullness),
      mood: Math.max(0, state.mood - before.mood),
      affection: Math.max(0, state.affection - before.affection),
    });
  }

  function runPetAction(action: PetAction, source: 'pet' | 'chat' = 'pet') {
    if (!action || resetting || !desktop.windows[source]?.isVisible()) return false;
    if (action.type === 'feed' && !['fish', 'can', 'treat'].includes(action.food)) return false;
    if (!['pet', 'feed', 'play', 'sleep', 'wake'].includes(action.type)) return false;
    const now = performance.now();
    if (pendingCare && pendingCare.expiresAt < now) pendingCare = undefined;
    if (action.type === 'sleep' && (pendingCare?.action.type === 'sleep' || db.pet().restingSince !== undefined)) return false;
    if (now - petAt < 500 && action.type !== 'wake') {
      if (!pendingCare) desktop.animate('blink');
      return false;
    }
    petAt = now;
    pendingCare = undefined;
    const animation = action.type === 'pet' ? 'petting' : action.type === 'feed' ? 'eating'
      : action.type === 'play' ? 'yarn' : action.type === 'sleep' ? 'sleeping' : 'waking';
    const timing = careContacts[animation];
    const id = randomUUID();
    pendingCare = { id, action, source, contactAt: now + timing.duration * timing.progress, expiresAt: now + timing.duration + 1500 };
    if (action.type !== 'sleep' && action.type !== 'wake') {
      const state = db.endPetRest();
      if (state) desktop.broadcast('pet:state', state);
    }
    const food = action.type === 'feed' ? action.food : undefined;
    desktop.emit(source, 'pet:animation', animation, food, id);
    if (source === 'chat' && animation !== 'waking') desktop.animate(animation, food);
    return true;
  }

  function localCommand(text: string): PetAction | undefined {
    const command = text.trim().replace(/[。！!.]+$/, '').toLowerCase();
    const name = petName(db.settings().petName).toLowerCase();
    if (command === '抚摸' + name || command === '摸摸' + name || command === 'pet ' + name) return { type: 'pet' };
    if (command === name + '休息' || command === name + ', go to sleep') return { type: 'sleep' };
    if (command === name + '醒醒' || command === 'wake up, ' + name) return { type: 'wake' };
    switch (command) {
      case 'pet dr. meow':
      case '摸摸你':
      case '抚摸猫博士': return { type: 'pet' };
      case 'feed dr. meow a fish':
      case '给你一条小鱼干':
      case '喂小鱼干': return { type: 'feed', food: 'fish' };
      case 'feed dr. meow canned food':
      case '喂猫罐头': return { type: 'feed', food: 'can' };
      case 'give dr. meow a treat':
      case '喂猫条': return { type: 'feed', food: 'treat' };
      case 'dr. meow, go to sleep':
      case '猫博士休息': return { type: 'sleep' };
      case 'wake up, dr. meow':
      case '猫博士醒醒': return { type: 'wake' };
    }
  }

  async function send(input: ChatSendInput, controller: AbortController): Promise<ChatSendResult> {
    const prefs = db.settings();
    const t = translator(prefs.locale);
    const conversation = db.chat(input.id);
    if (!conversation) throw new Error(t('找不到这个对话。', 'This chat could not be found.'));
    const messages = conversation.messages;
    const previous = messages.at(-1);
    const priorUser = messages.at(-2);
    const retry = input.retry === true && previous?.role === 'assistant' &&
      (previous.status === 'cancelled' || previous.status === 'error' || previous.search === 'unavailable') &&
      priorUser?.role === 'user';
    if (input.retry && !retry) throw new Error(t('这条回复无法重试。', 'This reply cannot be retried.'));
    const text = retry ? priorUser.text : input.text.trim();
    if (!text || text.length > 16_000) throw new Error(t('请输入 1 到 16,000 个字符。', 'Enter between 1 and 16,000 characters.'));
    const user: Message = retry ? priorUser : { id: randomUUID(), role: 'user', text, createdAt: Date.now() };
    const response: Message = {
      id: randomUUID(), role: 'assistant', text: '', createdAt: Date.now(), status: 'streaming'
    };
    const command = localCommand(text);
    if (!command) {
      let pet = db.currentPet();
      if (input.recover === true && careReason(pet)) {
        pet = db.recoverPet();
        desktop.animate('happy');
      }
      desktop.broadcast('pet:state', pet);
      if (careReason(pet)) return { status: 'care-required', pet };
    }
    const publish = () => desktop.emit('chat', 'chat:event', { conversationId: input.id, message: { ...response } });
    db.startTurn(input.id, user, response, retry ? previous.id : undefined);
    historyChanged();

    if (command) {
      const done = runPetAction(command, 'chat');
      response.text = done ? t('收到，喵！', 'You got it, meow!') : t('让我缓一下，马上就好。', 'Give me a moment, please.');
      response.status = 'complete';
      db.updateMessage(response);
      publish();
      return { status: 'complete' };
    }

    const rested = db.endPetRest();
    if (rested) desktop.broadcast('pet:state', rested);
    desktop.animate('thinking');
    let lastUpdate = 0;
    try {
      if (serviceStatus === 'limited') throw new UserMessageError(t('请先查看 ChatGPT 用量，再选择恢复请求。', 'Check your ChatGPT usage, then choose Resume requests.'));
      const catalog = await models();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!catalog.length) {
        throw new UserMessageError(auth.status().state === 'identity-only'
          ? t('请在账号设置中授权使用 ChatGPT 套餐。', 'Enable ChatGPT plan usage in your account settings.')
          : t('请先连接 ChatGPT 并确认有可用模型。', 'Connect ChatGPT and check that a model is available.'));
      }
      const model = [input.model, prefs.model]
        .find(id => catalog.some(entry => entry.id === id)) ?? catalog[0].id;
      const context = (retry ? messages.slice(0, -2) : messages)
        .filter(message => message.role === 'user' || (message.status === 'complete' && message.text))
        .slice(-16);
      const result = await ai.respond({
        model, messages: [...context, user], tone: prefs.tone, length: prefs.length, locale: prefs.locale, petName: prefs.petName,
        search: input.search === true, skipAutomaticSearch: retry && !input.search, signal: controller.signal,
        onDelta(delta) {
          if (!response.text) desktop.animate('speaking');
          response.text += delta;
          const now = Date.now();
          if (now - lastUpdate >= 60) {
            lastUpdate = now;
            publish();
          }
        }
      });
      response.text = result.text;
      response.sources = result.sources;
      response.search = result.search;
      response.status = 'complete';
      response.error = result.warning;
      serviceStatus = undefined;
      publishAuth();
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof AiError && error.code === 'cancelled');
      response.status = cancelled ? 'cancelled' : 'error';
      if (!cancelled) {
        response.error = error instanceof UserMessageError ? error.message : publicError(error);
        if (error instanceof AiError) {
          if (error.code === 'search_unavailable') response.search = 'unavailable';
          response.diagnostic = [
            error.stage, error.code, error.status === undefined ? undefined : 'HTTP ' + error.status,
            error.requestId ? 'Request ID ' + error.requestId : undefined
          ].filter(Boolean).join(' · ');
        }
        animateError(error);
      } else {
        desktop.animate('idle');
      }
    } finally {
      if (!quitting) {
        if (response.status === 'complete') {
          const before = petAtTime(db.pet());
          const pet = db.completeChatReply(user.id, response, Date.now(), prefs.petName);
          if (pet) desktop.broadcast('pet:state', pet, {
            fullness: pet.fullness - before.fullness,
            mood: pet.mood - before.mood,
            affection: pet.affection - before.affection,
          });
          const mood = moodFor(pet ?? db.pet());
          desktop.animate(mood === 'happy' || mood === 'content' ? 'happy' : 'idle');
        } else {
          db.updateMessage(response);
        }
        publish();
      }
    }
    return { status: 'complete' };
  }

  handle('settings:get', all, () => db.settings());
  handle('settings:update', ['pet', 'chat', 'settings'], (patch: Partial<Settings>) => {
    const old = db.settings();
    if (!patch || typeof patch !== 'object' || resetting) return old;
    const next = sanitizeSettings(patch, old);
    if (!smoke && app.isPackaged && next.startOnLogin !== old.startOnLogin) {
      app.setLoginItemSettings({ openAtLogin: next.startOnLogin });
    }
    db.saveSettings(next);
    desktop.updateSettings(next);
    if (next.locale !== old.locale) publishAuth();
    return next;
  });
  handle('pet:get', all, () => db.currentPet());
  handle('quota:get', all, () => quotaState());
  listen('quota:open', all, () => { void shell.openExternal(chatgptUsageUrl).catch(() => {}); });
  handle('pet:action', pet, (action: PetAction) => runPetAction(action));
  handle('chat:care', chat, (action: PetAction) => runPetAction(action, 'chat'));
  listen('pet:settle', ['pet', 'chat'], (event, id: string) => {
    const pending = pendingCare;
    if (!pending || id !== pending.id || resetting || !desktop.owns(event, [pending.source]) ||
        !desktop.windows[pending.source]?.isVisible()) return;
    const now = performance.now();
    if (now + 65 < pending.contactAt || now > pending.expiresAt) return;
    pendingCare = undefined;
    commitPetAction(pending.action);
    if (pending.source === 'chat' && pending.action.type === 'wake') desktop.animate('waking');
  });
  listen('pet:cancel', ['pet', 'chat'], (event, id: string) => {
    if (pendingCare?.id === id && desktop.owns(event, [pendingCare.source])) pendingCare = undefined;
  });
  listen('pet:end-rest', pet, () => {
    if (resetting) return;
    const state = db.endPetRest();
    if (state) desktop.broadcast('pet:state', state);
  });
  handle('chat:visible', pet, () => desktop.chatVisible());
  listen('pet:hit', pet, (_event, hit: boolean) => desktop.setPetHit(hit === true));
  listen('pet:press', pet, (_event, pressed: boolean) => desktop.setPetPress(pressed === true));
  listen('pet:keyboard', pet, (_event, active: boolean) => {
    const win = desktop.windows.pet;
    if (!win || win.isDestroyed()) return;
    win.setFocusable(active === true);
    if (active === true && win.isVisible()) win.focus();
  });
  listen('pet:drag', pet, (_event, phase: 'start' | 'move' | 'end') => desktop.petDrag(phase));
  listen('window:chat', all, (_event, search: boolean) => desktop.openChat(search === true));
  listen('window:settings', all, () => desktop.openSettings());
  listen('window:quit', pet, () => app.quit());
  listen('window:close', accountWindows, event => desktop.windows.chat?.webContents === event.sender
    ? desktop.windows.chat.close() : desktop.windows.settings?.close());
  listen('window:minimize', accountWindows, event => desktop.windows.chat?.webContents === event.sender
    ? desktop.windows.chat.minimize() : desktop.windows.settings?.minimize());
  listen('window:link', accountWindows, (_event, target: unknown) => {
    if (typeof target !== 'string' || target.length > 8192) return;
    try {
      const url = new URL(target);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
      void shell.openExternal(url.href).catch(() => {});
    } catch { /* Ignore malformed URLs. */ }
  });
  listen('window:copy', chat, (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= 500_000) clipboard.writeText(text);
  });
  handle('auth:get', accountWindows, authStatus);
  handle('auth:signIn', accountWindows, async (options?: SignInOptions) => {
    if (signInBusy || resetting || active) return authStatus();
    signInBusy = true;
    const generation = ++authGeneration;
    try {
      const result = await auth.signIn({
        reconsent: options?.reconsent === true, addAccount: options?.addAccount === true,
        accountId: typeof options?.accountId === 'string' ? options.accountId : undefined
      });
      if (generation !== authGeneration) return authStatus();
      const accepted = result.message === auth.status().message;
      if (accepted) {
        modelCache = undefined;
        serviceStatus = undefined;
        if (result.state === 'connected' || result.state === 'identity-only') desktop.animate('happy');
      }
      const status = !accepted && serviceStatus && result.state === 'connected'
        ? { ...result, state: serviceStatus } : result;
      publishAuth(status);
      return status;
    } catch (error) {
      if (generation !== authGeneration) return authStatus();
      const state = error instanceof AuthError ? error.code : 'error';
      const result: AuthStatus = { ...auth.status(), state, message: publicError(error) };
      publishAuth(result);
      return result;
    } finally {
      signInBusy = false;
    }
  });
  listen('auth:cancel', accountWindows, () => auth.cancel());
  handle('auth:signOut', accountWindows, async () => {
    if (resetting) return authStatus();
    authGeneration++;
    auth.cancel();
    active?.controller.abort();
    await active?.finished;
    modelCache = undefined;
    serviceStatus = undefined;
    const result = await auth.signOut();
    publishAuth(result);
    return result;
  });
  handle('ai:models', accountWindows, async () => {
    try { return await models(); }
    catch (error) { throw new Error(publicError(error)); }
  });
  handle('ai:resume', accountWindows, () => {
    if (serviceStatus === 'limited') serviceStatus = undefined;
    publishAuth();
    return authStatus();
  });
  handle('chat:list', chat, () => db.chats());
  handle('chat:new', chat, () => {
    if (resetting) throw new Error(t('正在清除数据。', 'Local data is being cleared.'));
    const result = db.createChat();
    historyChanged();
    return result;
  });
  handle('chat:rename', chat, (id: string, title: string) => {
    if (typeof id !== 'string' || typeof title !== 'string' || !title.trim() || resetting) return;
    db.rename(id, title.trim().slice(0, 120));
    historyChanged();
  });
  handle('chat:delete', chat, async (id: string) => {
    if (typeof id !== 'string' || resetting) return;
    if (active?.id === id) {
      active.controller.abort();
      await active.finished;
    }
    db.remove(id);
    historyChanged();
  });
  handle('chat:send', chat, async (input: ChatSendInput) => {
    if (!input || typeof input.text !== 'string' || typeof input.id !== 'string') throw new Error(t('无效的消息。', 'Invalid message.'));
    if (active || resetting || signInBusy) throw new Error(t('请等当前操作完成后再发送。', 'Wait for the current action to finish before sending.'));
    const request = { id: input.id, controller: new AbortController(), finished: undefined as Promise<ChatSendResult> | undefined };
    active = request;
    try {
      request.finished = send(input, request.controller);
      return await request.finished;
    } finally {
      if (active === request) active = undefined;
    }
  });
  listen('chat:cancel', chat, () => active?.controller.abort());
  handle('data:clearChats', settings, async () => {
    if (resetting) return;
    resetting = true;
    try {
      active?.controller.abort();
      await active?.finished;
      db.clearChats();
      historyChanged();
    } finally {
      resetting = false;
    }
  });
  handle('data:resetPet', settings, () => {
    if (resetting) return;
    pendingCare = undefined;
    db.resetPet();
    desktop.broadcast('pet:state', db.pet());
    desktop.animate('idle');
  });
  handle('data:clear', settings, async () => {
    if (resetting) return;
    resetting = true;
    pendingCare = undefined;
    try {
      authGeneration++;
      auth.cancel();
      active?.controller.abort();
      await active?.finished;
      const authResult = await auth.reset();
      modelCache = undefined;
      serviceStatus = undefined;
      if (!smoke && app.isPackaged && db.settings().startOnLogin) app.setLoginItemSettings({ openAtLogin: false });
      db.clearAll();
      await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
      desktop.updateSettings(db.settings());
      desktop.broadcast('pet:state', db.pet());
      desktop.animate('idle');
      publishAuth(authResult);
      historyChanged();
    } finally {
      resetting = false;
    }
  });

  desktop.start();
  app.on('second-instance', () => desktop.openChat());
  app.on('activate', () => desktop.openChat());
  app.on('window-all-closed', () => app.quit());
  powerMonitor.on('resume', () => {
    modelCache = undefined;
    desktop.reconcileDisplays();
    publishAuth();
  });
  app.on('before-quit', () => {
    quitting = true;
    auth.cancel();
    active?.controller.abort();
    desktop.close();
  });
  app.on('will-quit', () => db.close());

  if (smoke) {
    void import('./desktopSmoke.ts').then(({ runDesktopSmoke }) => runDesktopSmoke(desktop))
      .then(() => app.quit(), error => {
        console.error('Desktop smoke test failed', error);
        app.exit(1);
      });
  }
}

