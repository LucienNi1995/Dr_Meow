import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { app, Menu, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import type { Conversation, PetState, Point, Settings } from '../shared/contracts.ts';
import { besidePet, keepVisible, petViewport } from './geometry.ts';
import type { DesktopWindows } from './windows.ts';
import { fullscreenProbePath } from './fullscreenMonitor.ts';

async function until<T>(description: string, read: () => T | Promise<T>): Promise<Exclude<T, false | null | undefined>> {
  const end = Date.now() + 8_000;
  do {
    const value = await read();
    if (value) return value as Exclude<T, false | null | undefined>;
    await delay(45);
  } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}

function script<T>(win: BrowserWindow, source: string): Promise<T> {
  return win.webContents.executeJavaScript(source);
}

async function capture(win: BrowserWindow, name: string) {
  const output = process.env.DR_MEOW_SMOKE_CAPTURE_DIR;
  if (!output) return;
  await delay(180);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

function verifyFrameless(win: BrowserWindow) {
  assert.deepEqual(win.getBounds(), win.getContentBounds(), 'Window chrome changes the content bounds');
}

async function verifyPetCapture(pet: BrowserWindow) {
  const frame = await pet.webContents.capturePage();
  assert.ok(!frame.isEmpty(), 'The pet produced an empty capture');
  const bitmap = frame.toBitmap();
  let clear = 0;
  let opaque = 0;
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] === 0) clear++;
    else if (bitmap[index] > 230) opaque++;
  }
  assert.ok(clear > bitmap.length / 20, 'A substantial part of the pet capture should be transparent');
  assert.ok(opaque > 500, 'The pet capture should contain visible artwork');
  console.info(`Desktop smoke: frame alpha verified (${clear} transparent and ${opaque} opaque pixels)`);
}

async function exercisePetInput(pet: BrowserWindow, desktop: DesktopWindows) {
  const bounds = pet.getBounds();
  const target = await until('pet images and target', () => script<Point | null>(pet, `(() => {
    const target = document.querySelector('.pet-target');
    if (!target || ![...target.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)) return null;
    const box = target.getBoundingClientRect();
    return { x: Math.round(box.x + box.width * .49), y: Math.round(box.y + box.height * .44) };
  })()`));
  const clickThrough: boolean[] = [];
  const setIgnore = pet.setIgnoreMouseEvents.bind(pet);
  const originalCursor = screen.getCursorScreenPoint;
  const clearPoint = { x: bounds.x + 3, y: bounds.y + 3 };
  const artPoint = { x: bounds.x + target.x, y: bounds.y + target.y };
  let cursor = clearPoint;
  // CDP injects renderer events. The main process reads a synthetic screen position
  // so that the smoke test never moves the user's physical pointer.
  screen.getCursorScreenPoint = () => cursor;
  pet.setIgnoreMouseEvents = (ignore, options) => {
    clickThrough.push(ignore);
    setIgnore(ignore, options);
  };
  const cdp = pet.webContents.debugger;
  const mouse = (
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', x: number, y: number, held = false,
    button: 'left' | 'right' = 'left',
  ) =>
    cdp.sendCommand('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' ? 'none' : button,
      buttons: held ? button === 'right' ? 2 : 1 : 0, clickCount: 1,
    });
  const clickMenu = async (label: string, selector = '.pet-menu button') => {
    const point = await until(`menu button ${label}`, () => script<Point | null>(pet, `(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.includes(${JSON.stringify(label)}));
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    })()`));
    const [left, top] = pet.getPosition();
    cursor = { x: left + point.x, y: top + point.y };
    await mouse('mouseMoved', point.x, point.y);
    await mouse('mousePressed', point.x, point.y, true);
    await mouse('mouseReleased', point.x, point.y);
  };

  try {
    await delay(130);
    cursor = artPoint;
    await until('mouse capture on opaque artwork', () => clickThrough.at(-1) === false);
    cursor = clearPoint;
    await until('click-through outside the artwork', () => clickThrough.at(-1) === true);
    cursor = artPoint;
    await until('mouse capture restored', () => clickThrough.at(-1) === false);
    cdp.attach('1.3');
    await until('head hover reveals live status and actions', () => script<boolean>(pet,
      "document.querySelectorAll('.pet-status-stats dd').length === 2 && document.querySelectorAll('.pet-status-quotas button').length === 2 && Boolean(document.querySelector('.pet-status-actions'))"));
    await capture(pet, 'desktop-hover');
    const initial = await script<PetState>(pet, 'window.meow.getPet()');
    await clickMenu('抚摸', '.pet-status-actions button');
    await until('hover action updates affection while card stays open', async () => {
      const after = await script<PetState>(pet, 'window.meow.getPet()');
      return after.affection === initial.affection + 2 && await script<boolean>(pet,
        "Boolean(document.querySelector('.pet-status'))");
    });
    cursor = clearPoint;
    await mouse('mouseMoved', 3, 3);
    await until('status dismisses when pointer leaves artwork and card', () => script<boolean>(pet,
      "!document.querySelector('.pet-status')"));
    assert.equal(clickThrough.at(-1), true);
    cursor = artPoint;
    await until('hover point is interactive again', () => clickThrough.at(-1) === false);
    await delay(1300);
    console.info('Desktop smoke: head hover, live stats, action and click-through dismissal verified');

    const before = await script<PetState>(pet, 'window.meow.getPet()');
    await mouse('mouseMoved', target.x, target.y);
    await mouse('mousePressed', target.x, target.y, true);
    await mouse('mouseMoved', target.x - 8, target.y, true);
    await mouse('mouseReleased', target.x - 8, target.y);
    await until('head stroke increases affection', async () => {
      const after = await script<PetState>(pet, 'window.meow.getPet()');
      return after.affection === before.affection + 2;
    });
    assert.equal(desktop.windows.chat, undefined);

    const movement = { x: -38, y: -22 };
    const expected = keepVisible({ ...bounds, x: bounds.x + movement.x, y: bounds.y + movement.y },
      screen.getDisplayMatching(bounds).workArea);
    assert.notDeepEqual(expected, { x: bounds.x, y: bounds.y }, 'Smoke test requires room for a short drag');
    await mouse('mouseMoved', target.x, target.y);
    await mouse('mousePressed', target.x, target.y, true);
    await mouse('mouseMoved', target.x + movement.x, target.y + movement.y, true);
    await until('drag animation starts', () => script<boolean>(pet, "Boolean(document.querySelector('[data-animation=dragging]'))"));
    await delay(100);
    cursor = { x: cursor.x + movement.x, y: cursor.y + movement.y };
    await until('native pet window follows the drag', () => {
      const [x, y] = pet.getPosition();
      return x === expected.x && y === expected.y;
    });
    await mouse('mouseReleased', target.x, target.y);
    await until('drag animation ends', () => script<boolean>(pet, "!document.querySelector('[data-animation=dragging]')"));
    assert.equal(desktop.windows.chat, undefined, 'Dragging must not open chat');

    const beforeFeeding = await script<PetState>(pet, 'window.meow.getPet()');
    await delay(Math.max(0, 1300 - (Date.now() - beforeFeeding.lastInteractionAt)));
    await mouse('mousePressed', target.x, target.y, true, 'right');
    await mouse('mouseReleased', target.x, target.y, false, 'right');
    await clickMenu('喂食');
    await clickMenu('小鱼干');
    await until('feeding increases fullness and affection', async () => {
      const fed = await script<PetState>(pet, 'window.meow.getPet()');
      return fed.fullness >= beforeFeeding.fullness + 12 && fed.affection === beforeFeeding.affection + 2;
    });
    await until('food plays eating animation', () => script<boolean>(pet,
      "Boolean(document.querySelector('[data-animation=eating]'))"));
    cursor = { x: expected.x + target.x, y: expected.y + target.y };
    await mouse('mouseMoved', target.x, target.y);

    for (let count = 0; count < 2; count++) {
      await mouse('mousePressed', target.x, target.y, true);
      await mouse('mouseReleased', target.x, target.y);
    }
    await until('double click opens chat', () => desktop.windows.chat?.isVisible());
    console.info('Desktop smoke: alpha hit testing, head stroke, drag, right-click feeding, and double click verified');
    return expected;
  } finally {
    if (cdp.isAttached()) cdp.detach();
    screen.getCursorScreenPoint = originalCursor;
    pet.setIgnoreMouseEvents = setIgnore;
  }
}

export async function runDesktopSmoke(desktop: DesktopWindows): Promise<void> {
  if (process.platform === 'darwin') return runMacDesktopSmoke(desktop);
  const pet = await until('pet window', () => desktop.windows.pet?.isVisible() && desktop.windows.pet);
  const original = await script<Settings>(pet, 'window.meow.getSettings()');
  assert.equal(original.size, 180);
  assert.equal(original.avoidFullscreen, true);
  if (process.platform === 'win32') {
    const executable = fullscreenProbePath(app.isPackaged ? process.resourcesPath : undefined);
    const { stdout } = await promisify(execFile)(executable, ['--check'], { windowsHide: true, timeout: 5000 });
    assert.match(stdout.trim(), /^[01]$/);
    console.info('Desktop smoke: native Windows fullscreen probe runs from its distribution path');
  }
  assert.equal(pet.isAlwaysOnTop(), true);
  assert.equal(pet.isFocusable(), false);
  assert.equal(pet.isResizable(), false);
  verifyFrameless(pet);
  assert.equal(await script(pet, 'typeof require'), 'undefined');
  assert.equal(await script(pet, 'typeof window.meow.ipcRenderer'), 'undefined');

  await script(pet, 'window.meow.updateSettings({quiet: true})');
  await until('pet art is loaded', () => script<boolean>(pet, `(() => {
    const images = [...document.querySelectorAll('.pet-art img')];
    return images.length >= 2 && images.every(img => img.complete && img.naturalWidth > 0);
  })()`));
  await verifyPetCapture(pet);
  const dragPosition = await exercisePetInput(pet, desktop);

  const chat = desktop.windows.chat!;
  verifyFrameless(chat);
  assert.equal(chat.isResizable(), true);
  await until('chat composer and sign-in controls mount', () => script<boolean>(chat, `
    Boolean(document.querySelector('.chat-shell textarea') && document.querySelector('.composer select') &&
      [...document.querySelectorAll('button')].some(button => button.textContent.includes('Continue with ChatGPT')))
  `));
  const petBounds = pet.getBounds();
  const chatBounds = chat.getBounds();
  const area = screen.getDisplayMatching(petBounds).workArea;
  const chatPosition = besidePet(petBounds, chatBounds, area);
  assert.equal(chatBounds.x, chatPosition.x);
  assert.equal(chatBounds.y, chatPosition.y);

  const created = await script<Conversation>(chat, `window.meow.newChat()`);
  await script(chat, `window.meow.renameChat(${JSON.stringify(created.id)}, 'Desktop smoke history')`);
  const beforeChat = await script<PetState>(pet, 'window.meow.getPet()');
  await script(chat, `window.meow.sendChat({id: ${JSON.stringify(created.id)}, text: '猫博士醒醒', search: false})`);
  assert.equal((await script<PetState>(pet, 'window.meow.getPet()')).affection, beforeChat.affection + 1);
  const history = await script<Conversation[]>(chat, 'window.meow.listChats()');
  const saved = history.find(item => item.id === created.id);
  assert.equal(saved?.title, 'Desktop smoke history');
  assert.equal(saved?.messages.length, 2);
  assert.equal(saved?.messages[1].status, 'complete');

  await script(chat, 'window.meow.closePanel()');
  await until('chat hides on close', () => !chat.isVisible());
  assert.ok(pet.isVisible());
  await script(pet, 'window.meow.openChat()');
  await until('chat window reopens', () => chat.isVisible());
  assert.equal(await script(pet, 'window.meow.getChatVisible()'), true);
  assert.equal(desktop.windows.chat, chat);
  assert.deepEqual(await script(chat, 'window.meow.listChats()'), history);

  const reader = new DatabaseSync(join(app.getPath('userData'), 'dr-meow.sqlite'), { readOnly: true });
  try {
    const stored = reader.prepare('SELECT title FROM conversations WHERE id=?').get(created.id);
    assert.equal(stored?.title, 'Desktop smoke history');
    const savedPosition = reader.prepare("SELECT value FROM local_values WHERE key='position'").get();
    assert.deepEqual(JSON.parse(String(savedPosition?.value)), dragPosition);
  } finally {
    reader.close();
  }
  console.info('Desktop smoke: chat position, hide/reopen, and durable history and drag position verified');

  await script(pet, 'window.meow.openSettings()');
  const settings = await until('settings window', () => desktop.windows.settings?.isVisible() && desktop.windows.settings);
  await until('settings controls mount', () => script<boolean>(settings, `
    document.querySelectorAll('.settings-shell input[type=range]').length === 2 &&
    document.querySelectorAll('.settings-shell input[type=checkbox]').length >= 3
  `));
  await script(settings, `(() => {
    const select = document.querySelector('select[aria-label="语言"]');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until('English propagates to chat and settings', async () =>
    await script<boolean>(chat, 'Boolean(document.querySelector(\'textarea[aria-label="Message"]\')) && document.documentElement.lang === "en"') &&
    await script<boolean>(settings, 'Boolean(document.querySelector(\'select[aria-label="Language"]\'))'));
  const english = await script<Conversation>(chat, 'window.meow.newChat()');
  assert.equal(english.title, 'New chat');
  await script(chat, `window.meow.sendChat({id: ${JSON.stringify(english.id)}, text: 'Wake up, Dr. Meow!', search: false})`);
  await until('English local interaction response', async () =>
    (await script<Conversation[]>(chat, 'window.meow.listChats()'))
      .find(item => item.id === english.id)?.messages[1]?.text === 'You got it, meow!');
  await until('skin choices are rendered', () => script<boolean>(settings, "document.querySelectorAll('.skin-option').length === 4"));
  await capture(settings, 'skin-picker');
  for (const skin of ['ragdoll', 'british', 'calico', 'original']) {
    await script(settings, `document.querySelector('.skin-option[data-skin="${skin}"]').click()`);
    await until(`desktop displays ${skin} skin with cap`, () => script<boolean>(pet, `(() => {
      const character = document.querySelector('.pet-character[data-skin="${skin}"]');
      const layers = [...(character?.querySelectorAll('.pet-art img') ?? [])];
      return layers.length === 2 && layers.every(image => image.complete && image.naturalWidth > 0);
    })()`));
  }
  const appearance = await script<Settings>(settings, 'window.meow.getSettings()');
  assert.equal(appearance.locale, 'en');
  assert.equal(appearance.skin, 'original');
  console.info('Desktop smoke: English UI, local command, and four fitted skins verified');
  await script(settings, 'window.meow.updateSettings({ size: 360, alwaysOnTop: false })');
  assert.deepEqual(pet.getSize(), [petViewport(360).width, petViewport(360).height]);
  assert.equal(pet.isAlwaysOnTop(), false);
  await until('renderer reflects pet resize', () => script<boolean>(pet,
    "document.querySelector('.pet-target')?.getBoundingClientRect().width === 360"));
  await script(settings, 'window.meow.updateSettings({ size: 180, alwaysOnTop: true })');
  assert.equal(pet.isAlwaysOnTop(), true);
  await script(settings, 'window.meow.closePanel()');
  await until('settings hides on close', () => !settings.isVisible());

  const idle = (activity: string) => script<boolean>(pet,
    `Boolean(document.querySelector('.pet-character[data-animation="${activity}"] .pet-idle-props[data-activity="${activity}"]'))`);
  const savedCursor = screen.getCursorScreenPoint;
  screen.getCursorScreenPoint = () => {
    const [x, y] = pet.getPosition();
    return { x: x - 20, y: y - 20 };
  };
  try {
    await script(pet, 'window.meow.updateSettings({quiet: false})');
    await delay(150);
    desktop.animate('idle');
    desktop.animate('reading');
    await delay(180);
    assert.equal(await idle('reading'), false, 'Idle prop must not play while chat is visible');
    await script(chat, 'window.meow.closePanel()');
    await until('chat is closed for idle animation', async () => !await script(pet, 'window.meow.getChatVisible()'));
    for (const activity of ['yarn', 'reading', 'math', 'experiment'] as const) {
      desktop.animate('idle');
      desktop.animate(activity);
      await until(`${activity} art renders`, () => idle(activity));
      await capture(pet, `idle-${activity}`);
    }
    desktop.animate('thinking');
    await until('chat cue interrupts idle animation', () =>
      script<boolean>(pet, "Boolean(document.querySelector('.pet-character[data-animation=thinking]'))"));
    desktop.animate('idle');
  } finally {
    screen.getCursorScreenPoint = savedCursor;
    await script(pet, 'window.meow.updateSettings({quiet: true})');
  }
  console.info('Desktop smoke: yarn, magic book, math, and experiment render and yield to chat');

  const beforeFullscreen = pet.getBounds();
  desktop.setFullscreenObstruction(true);
  await until('fullscreen avoidance hides the cat', () => !pet.isVisible());
  desktop.setFullscreenObstruction(false);
  await until('the cat returns when fullscreen ends', () => pet.isVisible());
  assert.deepEqual(pet.getBounds(), beforeFullscreen);
  await script(pet, 'window.meow.updateSettings({avoidFullscreen: false})');
  desktop.setFullscreenObstruction(true);
  assert.equal(pet.isVisible(), true);
  desktop.setFullscreenObstruction(false);
  await script(pet, 'window.meow.updateSettings({avoidFullscreen: true})');

  pet.setPosition(area.x - 500, area.y - 500);
  desktop.reconcileDisplays();
  const reconciled = pet.getBounds();
  const workArea = screen.getDisplayMatching(reconciled).workArea;
  assert.deepEqual({ x: reconciled.x, y: reconciled.y }, keepVisible(reconciled, workArea));

  const primary = screen.getPrimaryDisplay();
  const secondary = screen.getAllDisplays().find(display => display.id !== primary.id &&
    display.workArea.width > reconciled.width + 32 && display.workArea.height > reconciled.height + 32);
  if (secondary) {
    pet.setPosition(primary.workArea.x + 16, primary.workArea.y + 16);
    await until('pet moves to the primary display', () => screen.getDisplayMatching(pet.getBounds()).id === primary.id);
    const secondaryArea = secondary.workArea;
    pet.setPosition(secondaryArea.x + 16, secondaryArea.y - 15);
    await until('pet moves to the secondary display', () => screen.getDisplayMatching(pet.getBounds()).id === secondary.id);
    desktop.reconcileDisplays();
    const moved = pet.getBounds();
    assert.equal(screen.getDisplayMatching(moved).id, secondary.id);
    assert.ok(Math.abs(moved.y - secondaryArea.y) <= 1, 'Reconciliation keeps the pet inside the secondary work area');
    await until('renderer uses the secondary display scale', async () =>
      Math.abs(await script<number>(pet, 'window.devicePixelRatio') - secondary.scaleFactor) < 0.05);
    console.info(`Desktop smoke: secondary work area and renderer scale ${secondary.scaleFactor} verified`);
  } else {
    console.info('Desktop smoke: secondary display check skipped (no usable secondary display)');
  }
  pet.close();
  await until('closing the pet hides it and leaves the app running', () => !pet.isVisible());
  desktop.setFullscreenObstruction(true);
  desktop.setFullscreenObstruction(false);
  assert.equal(pet.isVisible(), false, 'Fullscreen exit must preserve manually hidden state');
  console.info('Desktop smoke: fullscreen auto-hide, original-position restore, settings toggle, and manual hide verified');
  assert.ok(!pet.isDestroyed() && !chat.isDestroyed());
  console.info(`Desktop smoke: resize, topmost, settings, and geometry verified on ${screen.getAllDisplays().length} display(s), scale ${screen.getPrimaryDisplay().scaleFactor}`);
  app.once('quit', (_event, code) => console.info(`Desktop smoke: Electron quit with status ${code}`));
}

async function runMacDesktopSmoke(desktop: DesktopWindows): Promise<void> {
  const pet = await until('pet window', () => desktop.windows.pet?.isVisible() && desktop.windows.pet);
  await until('pet canvas is painted', () => script<boolean>(pet,
    "Boolean(document.querySelector('canvas.pet-motion[data-ready=true]'))"));
  verifyFrameless(pet);
  await verifyPetCapture(pet);
  assert.equal(pet.isFocusable(), false);
  assert.equal(pet.isAlwaysOnTop(), true);
  assert.equal(pet.isVisibleOnAllWorkspaces(), true);
  assert.equal(await script(pet, 'typeof require'), 'undefined');
  const roles = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items.map(child => child.role) ?? []);
  assert.ok(roles?.includes('copy') && roles.includes('paste'), 'Native editing commands are present');
  desktop.setPetHit(true);
  desktop.setPetHit(false);

  desktop.openChat();
  const chat = await until('chat window', () => desktop.windows.chat?.isVisible() && desktop.windows.chat);
  await until('chat composer mounts', () => script<boolean>(chat, "Boolean(document.querySelector('textarea'))"));
  verifyFrameless(chat);
  const conversation = await script<Conversation>(chat, 'window.meow.newChat()');
  await script(chat, `window.meow.renameChat(${JSON.stringify(conversation.id)}, 'Mac smoke history')`);
  chat.close();
  await until('chat hides on close', () => !chat.isVisible());
  assert.equal(pet.isVisible(), true);
  desktop.openChat();
  await until('chat reopens', () => chat.isVisible());
  assert.equal(desktop.windows.chat, chat);
  const history = await script<Conversation[]>(chat, 'window.meow.listChats()');
  assert.equal(history.find(item => item.id === conversation.id)?.title, 'Mac smoke history');

  desktop.openSettings();
  const settings = await until('settings window', () => desktop.windows.settings?.isVisible() && desktop.windows.settings);
  await until('settings mount', () => script<boolean>(settings,
    "document.querySelectorAll('.settings-shell input[type=checkbox]').length >= 3"));
  await script(settings, 'window.meow.updateSettings({alwaysOnTop: false, avoidFullscreen: false})');
  assert.equal(pet.isAlwaysOnTop(), false);
  assert.equal(pet.isVisibleOnAllWorkspaces(), true);
  await script(settings, 'window.meow.updateSettings({alwaysOnTop: true, avoidFullscreen: true})');
  assert.equal(pet.isAlwaysOnTop(), true);
  const before = pet.getBounds();
  desktop.setFullscreenObstruction(true);
  await until('fullscreen obstruction hides the pet', () => !pet.isVisible());
  desktop.setFullscreenObstruction(false);
  await until('pet returns', () => pet.isVisible());
  assert.deepEqual(pet.getBounds(), before);
  const area = screen.getDisplayMatching(before).workArea;
  pet.setPosition(area.x - 500, area.y - 500);
  desktop.reconcileDisplays();
  const bounds = pet.getBounds();
  assert.deepEqual({ x: bounds.x, y: bounds.y }, keepVisible(bounds, screen.getDisplayMatching(bounds).workArea));
  pet.close();
  await until('pet hides on close', () => !pet.isVisible());
  desktop.setFullscreenObstruction(true);
  desktop.setFullscreenObstruction(false);
  assert.equal(pet.isVisible(), false);
  console.info('macOS smoke: transparent canvas, native edit menu, Spaces configuration, click-through calls, chat hide/reopen, history, settings, topmost, visibility and display bounds passed');
  console.info('macOS smoke: physical click-through, fullscreen Space switching, Keychain login and launch-at-login require manual verification');
}
