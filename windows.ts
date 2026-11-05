import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Animation, Food, Point, Settings, WindowKind } from '../shared/contracts.ts';
import { translator } from '../shared/i18n.ts';
import { besidePet, keepVisible, petViewport } from './geometry.ts';
import type { LocalDatabase } from './database.ts';
import { fullscreenProbePath, watchFullscreen } from './fullscreenMonitor.ts';

const rendererFile = join(__dirname, '../renderer/index.html');
const dev = !app.isPackaged && process.env.DR_MEOW_DEV === '1';
const rendererBase = dev ? 'http://127.0.0.1:4177/' : pathToFileURL(rendererFile).href;

export class DesktopWindows {
  readonly windows: Partial<Record<WindowKind, BrowserWindow>> = {};
  private tray?: Tray;
  private timer?: ReturnType<typeof setInterval>;
  private cursor: Point | null = null;
  private hasPointer = false;
  private interactive = false;
  private pointerHeld = false;
  private positionLocked = false;
  private drag?: { cursor: Point; window: Point };
  private chatSearch = false;
  private petReady = false;
  private petWanted = true;
  private avoidFullscreen = true;
  private fullscreenObstruction = false;
  private stopFullscreenMonitor?: () => void;

  constructor(
    private readonly db: LocalDatabase,
    private readonly isQuitting: () => boolean,
    private readonly monitorFullscreen = true,
  ) {}

  owns(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, kinds: WindowKind[]) {
    return kinds.some(kind => {
      const win = this.windows[kind];
      return win && !win.isDestroyed() && event.sender === win.webContents &&
        event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === this.url(kind);
    });
  }

  private url(kind: WindowKind) { return rendererBase + '#' + kind; }

  private make(kind: WindowKind, options: Electron.BrowserWindowConstructorOptions) {
    const win = new BrowserWindow({
      ...options, show: false, frame: false, autoHideMenuBar: true,
      icon: join(__dirname, '../renderer/assets/app.ico'),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: dev
      }
    });
    this.windows[kind] = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-redirect', event => event.preventDefault());
    void win.loadURL(this.url(kind)).catch(() => {
      if (!win.isDestroyed()) win.destroy();
    });
    win.once('closed', () => { delete this.windows[kind]; });
    return win;
  }

  start() {
    const settings = this.db.settings();
    this.avoidFullscreen = settings.avoidFullscreen;
    this.positionLocked = settings.positionLocked;
    const size = petViewport(settings.size);
    const previous = this.db.position();
    const area = previous ? screen.getDisplayNearestPoint(previous).workArea : screen.getPrimaryDisplay().workArea;
    const position = previous ?? {
      x: area.x + area.width - size.width - 22,
      y: area.y + area.height - size.height - 12
    };
    const pet = this.make('pet', {
      ...size, ...keepVisible({ ...size, ...position }, area),
      transparent: true, hasShadow: false, backgroundColor: '#00000000',
      resizable: false, maximizable: false, fullscreenable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: settings.alwaysOnTop
    });
    pet.setIgnoreMouseEvents(true, { forward: true });
    pet.once('ready-to-show', () => {
      this.petReady = true;
      this.syncPetVisibility();
    });
    pet.on('show', () => { this.refreshTray(); this.trackPointer(); });
    pet.on('hide', () => {
      pet.setFocusable(false);
      this.pointerHeld = false;
      this.finishDrag();
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.hasPointer = false;
      this.cursor = null;
      this.setPetHit(false);
      this.emit('pet', 'pet:pointer', null);
      this.refreshTray();
    });
    pet.on('close', event => {
      if (this.isQuitting()) return;
      event.preventDefault();
      this.petWanted = false;
      this.syncPetVisibility();
    });
    this.syncFullscreenMonitor();
    const icon = nativeImage.createFromPath(join(__dirname, '../renderer/assets/tray.png'));
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(process.execPath) : icon);
    this.tray.on('double-click', () => this.togglePet());
    this.refreshTray();
    screen.on('display-added', () => this.reconcileDisplays());
    screen.on('display-removed', () => this.reconcileDisplays());
    screen.on('display-metrics-changed', () => this.reconcileDisplays());
  }

  private trackPointer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollPointer(), 45);
    this.pollPointer();
  }

  private pollPointer() {
    const win = this.windows.pet;
    if (!win?.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    if (this.drag) this.moveDrag(cursor);
    const { x, y, width, height } = win.getBounds();
    const local = { x: cursor.x - x, y: cursor.y - y };
    const inside = local.x >= 0 && local.y >= 0 && local.x < width && local.y < height;
    if (!inside && !this.drag && !this.pointerHeld) this.setPetHit(false);
    if (inside && (!this.hasPointer || local.x !== this.cursor?.x || local.y !== this.cursor?.y)) {
      this.emit('pet', 'pet:pointer', local);
    } else if (!inside && this.hasPointer) {
      this.emit('pet', 'pet:pointer', null);
    }
    this.hasPointer = inside;
    this.cursor = inside ? local : null;
  }

  setPetHit(active: boolean) {
    const pet = this.windows.pet;
    if (!pet || pet.isDestroyed()) return;
    const next = pet.isVisible() && Boolean(this.drag || this.pointerHeld || active);
    if (this.interactive === next) return;
    this.interactive = next;
    pet.setIgnoreMouseEvents(!next, { forward: true });
  }

  setPetPress(pressed: boolean) {
    this.pointerHeld = pressed && this.windows.pet?.isVisible() === true;
    if (this.pointerHeld) this.setPetHit(true);
    else this.pollPointer();
  }

  petDrag(phase: 'start' | 'move' | 'end') {
    const pet = this.windows.pet;
    if (!pet?.isVisible() || this.positionLocked) return;
    if (phase === 'start' && !this.drag) {
      const [x, y] = pet.getPosition();
      this.drag = { cursor: screen.getCursorScreenPoint(), window: { x, y } };
      this.setPetHit(true);
    } else if (phase === 'move' && this.drag) {
      this.moveDrag(screen.getCursorScreenPoint());
    } else if (phase === 'end') {
      this.finishDrag();
    }
  }

  private moveDrag(cursor: Point) {
    const pet = this.windows.pet;
    if (!pet || !this.drag) return;
    const position = {
      x: this.drag.window.x + cursor.x - this.drag.cursor.x,
      y: this.drag.window.y + cursor.y - this.drag.cursor.y
    };
    const bounds = pet.getBounds();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const point = keepVisible({ ...bounds, ...position }, area);
    if (bounds.x !== point.x || bounds.y !== point.y) pet.setPosition(point.x, point.y);
  }

  private finishDrag() {
    if (!this.drag) return;
    this.moveDrag(screen.getCursorScreenPoint());
    this.drag = undefined;
    const [x, y] = this.windows.pet?.getPosition() ?? [0, 0];
    this.db.savePosition({ x, y });
    this.pollPointer();
  }

  private togglePet() {
    this.petWanted = !this.petWanted;
    this.syncPetVisibility();
  }

  private syncPetVisibility() {
    const pet = this.windows.pet;
    if (!pet || pet.isDestroyed() || !this.petReady || this.isQuitting()) return;
    const visible = this.petWanted && !(this.avoidFullscreen && this.fullscreenObstruction);
    if (visible && !pet.isVisible()) pet.showInactive();
    else if (!visible && pet.isVisible()) pet.hide();
    else this.refreshTray();
  }

  setFullscreenObstruction(covered: boolean) {
    if (this.fullscreenObstruction === covered) return;
    this.fullscreenObstruction = covered;
    this.syncPetVisibility();
  }

  private syncFullscreenMonitor() {
    const pet = this.windows.pet;
    if (!this.avoidFullscreen) {
      this.stopFullscreenMonitor?.();
      this.stopFullscreenMonitor = undefined;
      this.setFullscreenObstruction(false);
    } else if (this.monitorFullscreen && process.platform === 'win32' && pet && !this.stopFullscreenMonitor) {
      const path = fullscreenProbePath(app.isPackaged ? process.resourcesPath : undefined);
      const handle = pet.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
      this.stopFullscreenMonitor = watchFullscreen(path, hwnd, covered => this.setFullscreenObstruction(covered));
    }
  }

  private refreshTray() {
    const t = translator(this.db.settings().locale);
    this.tray?.setToolTip(t('Dr. Meow · 猫博士', 'Dr. Meow'));
    this.tray?.setContextMenu(Menu.buildFromTemplate([
      { label: this.petWanted ? t('隐藏猫博士', 'Hide Dr. Meow') : t('显示猫博士', 'Show Dr. Meow'), click: () => this.togglePet() },
      ...(this.petWanted && this.avoidFullscreen && this.fullscreenObstruction ? [{
        label: t('全屏期间暂时隐藏', 'Temporarily hidden during fullscreen'), enabled: false,
      }] : []),
      { label: t('打开聊天', 'Open chat'), click: () => this.openChat() },
      { label: t('设置', 'Settings'), click: () => this.openSettings() },
      { type: 'separator' },
      { label: t('退出 Dr. Meow', 'Quit Dr. Meow'), click: () => app.quit() }
    ]));
  }

  chatVisible() {
    const chat = this.windows.chat;
    return Boolean(chat?.isVisible() && !chat.isMinimized());
  }

  openChat(search = false) {
    this.chatSearch = search;
    const existing = this.windows.chat;
    if (existing) {
      const pet = this.windows.pet?.getBounds();
      if (pet && !existing.isVisible()) {
        const area = screen.getDisplayMatching(pet).workArea;
        const point = besidePet(pet, existing.getBounds(), area);
        existing.setPosition(point.x, point.y);
      }
      if (existing.isMinimized()) existing.restore();
      existing.show();
      this.emit('chat', 'chat:search', search);
      this.animate('greet');
      return existing;
    }
    const pet = this.windows.pet?.getBounds();
    const area = pet ? screen.getDisplayMatching(pet).workArea : screen.getPrimaryDisplay().workArea;
    const panel = { x: area.x, y: area.y, width: 396, height: 516 };
    const chat = this.make('chat', {
      ...panel, ...(pet ? besidePet(pet, panel, area) : keepVisible(panel, area)),
      minWidth: 320, minHeight: 300, backgroundColor: '#fff9f5', maximizable: false
    });
    chat.once('ready-to-show', () => {
      this.emit('chat', 'chat:search', this.chatSearch);
      chat.show();
    });
    const publishVisibility = () => this.emit('pet', 'chat:visibility', this.chatVisible());
    chat.on('show', publishVisibility);
    chat.on('hide', publishVisibility);
    chat.on('minimize', publishVisibility);
    chat.on('restore', publishVisibility);
    chat.on('closed', publishVisibility);
    chat.on('close', event => {
      if (this.isQuitting()) return;
      event.preventDefault();
      chat.hide();
      this.animate('farewell');
    });
    this.animate('greet');
    return chat;
  }

  openSettings() {
    const existing = this.windows.settings;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      return existing;
    }
    const panel = this.make('settings', {
      width: 478, height: 640, minWidth: 350, minHeight: 360,
      backgroundColor: '#fff9f5', maximizable: false
    });
    panel.once('ready-to-show', () => panel.show());
    panel.on('close', event => {
      if (!this.isQuitting()) {
        event.preventDefault();
        panel.hide();
      }
    });
    return panel;
  }

  updateSettings(settings: Settings) {
    const pet = this.windows.pet;
    if (settings.positionLocked && !this.positionLocked) {
      this.finishDrag();
      if (pet) {
        const [x, y] = pet.getPosition();
        this.db.savePosition({ x, y });
      }
    }
    this.positionLocked = settings.positionLocked;
    if (pet) {
      const bounds = pet.getBounds();
      const size = petViewport(settings.size);
      const area = screen.getDisplayMatching(bounds).workArea;
      const next = {
        ...size, x: bounds.x + bounds.width - size.width, y: bounds.y + bounds.height - size.height
      };
      const point = keepVisible(next, area);
      if (next.width !== bounds.width || next.height !== bounds.height) {
        pet.setBounds({ ...next, ...point });
        this.db.savePosition(point);
      }
      pet.setAlwaysOnTop(settings.alwaysOnTop);
    }
    this.avoidFullscreen = settings.avoidFullscreen;
    this.syncFullscreenMonitor();
    this.syncPetVisibility();
    this.broadcast('settings:changed', settings);
  }

  reconcileDisplays() {
    for (const win of Object.values(this.windows)) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const point = keepVisible(bounds, area);
      if (point.x !== bounds.x || point.y !== bounds.y) win.setPosition(point.x, point.y);
      if (win === this.windows.pet) this.db.savePosition(point);
    }
    this.pollPointer();
  }

  animate(animation: Animation, food?: Food, careId?: string) { this.emit('pet', 'pet:animation', animation, food, careId); }

  emit(kind: WindowKind, channel: string, ...args: unknown[]) {
    const win = this.windows[kind];
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
  }

  broadcast(channel: string, ...args: unknown[]) {
    for (const kind of Object.keys(this.windows) as WindowKind[]) this.emit(kind, channel, ...args);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.stopFullscreenMonitor?.();
    this.tray?.destroy();
  }
}

