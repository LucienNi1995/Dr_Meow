"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/geometry.ts
function petViewport(size) {
  return { width: Math.max(size, 248), height: size + 130 };
}
function keepVisible(bounds, area) {
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - bounds.width),
    y: clamp(bounds.y, area.y, area.y + area.height - bounds.height)
  };
}
function besidePet(pet, panel, area) {
  const gap = 14;
  const right = pet.x + pet.width + gap;
  return keepVisible({
    ...panel,
    x: right + panel.width <= area.x + area.width ? right : pet.x - panel.width - gap,
    y: pet.y + pet.height - panel.height
  }, area);
}
var clamp;
var init_geometry = __esm({
  "electron/geometry.ts"() {
    "use strict";
    clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }
});

// electron/fullscreenMonitor.ts
function fullscreenProbePath(resources) {
  return (0, import_node_path2.join)(resources ?? (0, import_node_path2.join)(__dirname, ".."), "native", "FullscreenProbe.exe");
}
function watchFullscreen(executable, hwnd, onChange) {
  const child = (0, import_node_child_process.spawn)(executable, [hwnd.toString(), String(process.pid)], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"]
  });
  const lines = (0, import_node_readline.createInterface)({ input: child.stdout, crlfDelay: Infinity });
  let stopped = false;
  let covered = false;
  let clearSamples = 0;
  let lastSampleAt = performance.now();
  let watchdog;
  function publish(next) {
    if (covered === next) return;
    covered = next;
    onChange(next);
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    if (watchdog) clearInterval(watchdog);
    lines.close();
    child.stdin.end();
    child.kill();
  }
  lines.on("line", (value) => {
    if (stopped || value !== "0" && value !== "1") return;
    lastSampleAt = performance.now();
    if (value === "1") {
      clearSamples = 0;
      publish(true);
    } else if (++clearSamples >= 2) {
      publish(false);
    }
  });
  child.stdin.on("error", () => {
  });
  function recover() {
    if (stopped) return;
    stop();
    publish(false);
  }
  child.once("error", recover);
  child.once("close", recover);
  watchdog = setInterval(() => {
    if (performance.now() - lastSampleAt >= 2500) publish(false);
  }, 1e3);
  return stop;
}
var import_node_child_process, import_node_path2, import_node_readline;
var init_fullscreenMonitor = __esm({
  "electron/fullscreenMonitor.ts"() {
    "use strict";
    import_node_child_process = require("node:child_process");
    import_node_path2 = require("node:path");
    import_node_readline = require("node:readline");
  }
});

// electron/desktopSmoke.ts
var desktopSmoke_exports = {};
__export(desktopSmoke_exports, {
  runDesktopSmoke: () => runDesktopSmoke
});
async function until(description, read) {
  const end = Date.now() + 8e3;
  do {
    const value = await read();
    if (value) return value;
    await (0, import_promises2.setTimeout)(45);
  } while (Date.now() < end);
  throw new Error(`Timed out: ${description}`);
}
function script(win, source) {
  return win.webContents.executeJavaScript(source);
}
async function capture(win, name) {
  const output = process.env.DR_MEOW_SMOKE_CAPTURE_DIR;
  if (!output) return;
  await (0, import_promises2.setTimeout)(180);
  (0, import_node_fs2.mkdirSync)(output, { recursive: true });
  (0, import_node_fs2.writeFileSync)((0, import_node_path4.join)(output, name + ".png"), (await win.webContents.capturePage()).toPNG());
}
function verifyFrameless(win) {
  import_strict.default.deepEqual(win.getBounds(), win.getContentBounds(), "Window chrome changes the content bounds");
}
async function verifyPetCapture(pet) {
  const frame = await pet.webContents.capturePage();
  import_strict.default.ok(!frame.isEmpty(), "The pet produced an empty capture");
  const bitmap = frame.toBitmap();
  let clear = 0;
  let opaque = 0;
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] === 0) clear++;
    else if (bitmap[index] > 230) opaque++;
  }
  import_strict.default.ok(clear > bitmap.length / 20, "A substantial part of the pet capture should be transparent");
  import_strict.default.ok(opaque > 500, "The pet capture should contain visible artwork");
  console.info(`Desktop smoke: frame alpha verified (${clear} transparent and ${opaque} opaque pixels)`);
}
async function exercisePetInput(pet, desktop) {
  const bounds = pet.getBounds();
  const target = await until("pet images and target", () => script(pet, `(() => {
    const target = document.querySelector('.pet-target');
    if (!target || ![...target.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)) return null;
    const box = target.getBoundingClientRect();
    return { x: Math.round(box.x + box.width * .49), y: Math.round(box.y + box.height * .44) };
  })()`));
  const clickThrough = [];
  const setIgnore = pet.setIgnoreMouseEvents.bind(pet);
  const originalCursor = import_electron2.screen.getCursorScreenPoint;
  const clearPoint = { x: bounds.x + 3, y: bounds.y + 3 };
  const artPoint = { x: bounds.x + target.x, y: bounds.y + target.y };
  let cursor = clearPoint;
  import_electron2.screen.getCursorScreenPoint = () => cursor;
  pet.setIgnoreMouseEvents = (ignore, options) => {
    clickThrough.push(ignore);
    setIgnore(ignore, options);
  };
  const cdp = pet.webContents.debugger;
  const mouse = (type, x, y, held = false, button = "left") => cdp.sendCommand("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseMoved" ? "none" : button,
    buttons: held ? button === "right" ? 2 : 1 : 0,
    clickCount: 1
  });
  const clickMenu = async (label, selector = ".pet-menu button") => {
    const point = await until(`menu button ${label}`, () => script(pet, `(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.includes(${JSON.stringify(label)}));
      if (!button) return null;
      const box = button.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    })()`));
    const [left, top] = pet.getPosition();
    cursor = { x: left + point.x, y: top + point.y };
    await mouse("mouseMoved", point.x, point.y);
    await mouse("mousePressed", point.x, point.y, true);
    await mouse("mouseReleased", point.x, point.y);
  };
  try {
    await (0, import_promises2.setTimeout)(130);
    cursor = artPoint;
    await until("mouse capture on opaque artwork", () => clickThrough.at(-1) === false);
    cursor = clearPoint;
    await until("click-through outside the artwork", () => clickThrough.at(-1) === true);
    cursor = artPoint;
    await until("mouse capture restored", () => clickThrough.at(-1) === false);
    cdp.attach("1.3");
    await until("head hover reveals live status and actions", () => script(
      pet,
      "document.querySelectorAll('.pet-status-stats dd').length === 2 && document.querySelectorAll('.pet-status-quotas button').length === 2 && Boolean(document.querySelector('.pet-status-actions'))"
    ));
    await capture(pet, "desktop-hover");
    const initial = await script(pet, "window.meow.getPet()");
    await clickMenu("\u629A\u6478", ".pet-status-actions button");
    await until("hover action updates affection while card stays open", async () => {
      const after = await script(pet, "window.meow.getPet()");
      return after.affection === initial.affection + 2 && await script(
        pet,
        "Boolean(document.querySelector('.pet-status'))"
      );
    });
    cursor = clearPoint;
    await mouse("mouseMoved", 3, 3);
    await until("status dismisses when pointer leaves artwork and card", () => script(
      pet,
      "!document.querySelector('.pet-status')"
    ));
    import_strict.default.equal(clickThrough.at(-1), true);
    cursor = artPoint;
    await until("hover point is interactive again", () => clickThrough.at(-1) === false);
    await (0, import_promises2.setTimeout)(1300);
    console.info("Desktop smoke: head hover, live stats, action and click-through dismissal verified");
    const before = await script(pet, "window.meow.getPet()");
    await mouse("mouseMoved", target.x, target.y);
    await mouse("mousePressed", target.x, target.y, true);
    await mouse("mouseMoved", target.x - 8, target.y, true);
    await mouse("mouseReleased", target.x - 8, target.y);
    await until("head stroke increases affection", async () => {
      const after = await script(pet, "window.meow.getPet()");
      return after.affection === before.affection + 2;
    });
    import_strict.default.equal(desktop.windows.chat, void 0);
    const movement = { x: -38, y: -22 };
    const expected = keepVisible(
      { ...bounds, x: bounds.x + movement.x, y: bounds.y + movement.y },
      import_electron2.screen.getDisplayMatching(bounds).workArea
    );
    import_strict.default.notDeepEqual(expected, { x: bounds.x, y: bounds.y }, "Smoke test requires room for a short drag");
    await mouse("mouseMoved", target.x, target.y);
    await mouse("mousePressed", target.x, target.y, true);
    await mouse("mouseMoved", target.x + movement.x, target.y + movement.y, true);
    await until("drag animation starts", () => script(pet, "Boolean(document.querySelector('[data-animation=dragging]'))"));
    await (0, import_promises2.setTimeout)(100);
    cursor = { x: cursor.x + movement.x, y: cursor.y + movement.y };
    await until("native pet window follows the drag", () => {
      const [x, y] = pet.getPosition();
      return x === expected.x && y === expected.y;
    });
    await mouse("mouseReleased", target.x, target.y);
    await until("drag animation ends", () => script(pet, "!document.querySelector('[data-animation=dragging]')"));
    import_strict.default.equal(desktop.windows.chat, void 0, "Dragging must not open chat");
    const beforeFeeding = await script(pet, "window.meow.getPet()");
    await (0, import_promises2.setTimeout)(Math.max(0, 1300 - (Date.now() - beforeFeeding.lastInteractionAt)));
    await mouse("mousePressed", target.x, target.y, true, "right");
    await mouse("mouseReleased", target.x, target.y, false, "right");
    await clickMenu("\u5582\u98DF");
    await clickMenu("\u5C0F\u9C7C\u5E72");
    await until("feeding increases fullness and affection", async () => {
      const fed = await script(pet, "window.meow.getPet()");
      return fed.fullness >= beforeFeeding.fullness + 12 && fed.affection === beforeFeeding.affection + 2;
    });
    await until("food plays eating animation", () => script(
      pet,
      "Boolean(document.querySelector('[data-animation=eating]'))"
    ));
    cursor = { x: expected.x + target.x, y: expected.y + target.y };
    await mouse("mouseMoved", target.x, target.y);
    for (let count = 0; count < 2; count++) {
      await mouse("mousePressed", target.x, target.y, true);
      await mouse("mouseReleased", target.x, target.y);
    }
    await until("double click opens chat", () => desktop.windows.chat?.isVisible());
    console.info("Desktop smoke: alpha hit testing, head stroke, drag, right-click feeding, and double click verified");
    return expected;
  } finally {
    if (cdp.isAttached()) cdp.detach();
    import_electron2.screen.getCursorScreenPoint = originalCursor;
    pet.setIgnoreMouseEvents = setIgnore;
  }
}
async function runDesktopSmoke(desktop) {
  const pet = await until("pet window", () => desktop.windows.pet?.isVisible() && desktop.windows.pet);
  const original = await script(pet, "window.meow.getSettings()");
  import_strict.default.equal(original.size, 180);
  import_strict.default.equal(original.avoidFullscreen, true);
  if (process.platform === "win32") {
    const executable = fullscreenProbePath(import_electron2.app.isPackaged ? process.resourcesPath : void 0);
    const { stdout } = await (0, import_node_util.promisify)(import_node_child_process2.execFile)(executable, ["--check"], { windowsHide: true, timeout: 5e3 });
    import_strict.default.match(stdout.trim(), /^[01]$/);
    console.info("Desktop smoke: native Windows fullscreen probe runs from its distribution path");
  }
  import_strict.default.equal(pet.isAlwaysOnTop(), true);
  import_strict.default.equal(pet.isFocusable(), false);
  import_strict.default.equal(pet.isResizable(), false);
  verifyFrameless(pet);
  import_strict.default.equal(await script(pet, "typeof require"), "undefined");
  import_strict.default.equal(await script(pet, "typeof window.meow.ipcRenderer"), "undefined");
  await script(pet, "window.meow.updateSettings({quiet: true})");
  await until("pet art is loaded", () => script(pet, `(() => {
    const images = [...document.querySelectorAll('.pet-art img')];
    return images.length >= 2 && images.every(img => img.complete && img.naturalWidth > 0);
  })()`));
  await verifyPetCapture(pet);
  const dragPosition = await exercisePetInput(pet, desktop);
  const chat = desktop.windows.chat;
  verifyFrameless(chat);
  import_strict.default.equal(chat.isResizable(), true);
  await until("chat composer and sign-in controls mount", () => script(chat, `
    Boolean(document.querySelector('.chat-shell textarea') && document.querySelector('.composer select') &&
      [...document.querySelectorAll('button')].some(button => button.textContent.includes('Continue with ChatGPT')))
  `));
  const petBounds = pet.getBounds();
  const chatBounds = chat.getBounds();
  const area = import_electron2.screen.getDisplayMatching(petBounds).workArea;
  const chatPosition = besidePet(petBounds, chatBounds, area);
  import_strict.default.equal(chatBounds.x, chatPosition.x);
  import_strict.default.equal(chatBounds.y, chatPosition.y);
  const created = await script(chat, `window.meow.newChat()`);
  await script(chat, `window.meow.renameChat(${JSON.stringify(created.id)}, 'Desktop smoke history')`);
  const beforeChat = await script(pet, "window.meow.getPet()");
  await script(chat, `window.meow.sendChat({id: ${JSON.stringify(created.id)}, text: '\u732B\u535A\u58EB\u9192\u9192', search: false})`);
  import_strict.default.equal((await script(pet, "window.meow.getPet()")).affection, beforeChat.affection + 1);
  const history = await script(chat, "window.meow.listChats()");
  const saved = history.find((item) => item.id === created.id);
  import_strict.default.equal(saved?.title, "Desktop smoke history");
  import_strict.default.equal(saved?.messages.length, 2);
  import_strict.default.equal(saved?.messages[1].status, "complete");
  await script(chat, "window.meow.closePanel()");
  await until("chat hides on close", () => !chat.isVisible());
  import_strict.default.ok(pet.isVisible());
  await script(pet, "window.meow.openChat()");
  await until("chat window reopens", () => chat.isVisible());
  import_strict.default.equal(await script(pet, "window.meow.getChatVisible()"), true);
  import_strict.default.equal(desktop.windows.chat, chat);
  import_strict.default.deepEqual(await script(chat, "window.meow.listChats()"), history);
  const reader = new import_node_sqlite2.DatabaseSync((0, import_node_path4.join)(import_electron2.app.getPath("userData"), "dr-meow.sqlite"), { readOnly: true });
  try {
    const stored = reader.prepare("SELECT title FROM conversations WHERE id=?").get(created.id);
    import_strict.default.equal(stored?.title, "Desktop smoke history");
    const savedPosition = reader.prepare("SELECT value FROM local_values WHERE key='position'").get();
    import_strict.default.deepEqual(JSON.parse(String(savedPosition?.value)), dragPosition);
  } finally {
    reader.close();
  }
  console.info("Desktop smoke: chat position, hide/reopen, and durable history and drag position verified");
  await script(pet, "window.meow.openSettings()");
  const settings = await until("settings window", () => desktop.windows.settings?.isVisible() && desktop.windows.settings);
  await until("settings controls mount", () => script(settings, `
    document.querySelectorAll('.settings-shell input[type=range]').length === 2 &&
    document.querySelectorAll('.settings-shell input[type=checkbox]').length >= 3
  `));
  await script(settings, `(() => {
    const select = document.querySelector('select[aria-label="\u8BED\u8A00"]');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until("English propagates to chat and settings", async () => await script(chat, `Boolean(document.querySelector('textarea[aria-label="Message"]')) && document.documentElement.lang === "en"`) && await script(settings, `Boolean(document.querySelector('select[aria-label="Language"]'))`));
  const english = await script(chat, "window.meow.newChat()");
  import_strict.default.equal(english.title, "New chat");
  await script(chat, `window.meow.sendChat({id: ${JSON.stringify(english.id)}, text: 'Wake up, Dr. Meow!', search: false})`);
  await until("English local interaction response", async () => (await script(chat, "window.meow.listChats()")).find((item) => item.id === english.id)?.messages[1]?.text === "You got it, meow!");
  await until("skin choices are rendered", () => script(settings, "document.querySelectorAll('.skin-option').length === 4"));
  await capture(settings, "skin-picker");
  for (const skin of ["ragdoll", "british", "calico", "original"]) {
    await script(settings, `document.querySelector('.skin-option[data-skin="${skin}"]').click()`);
    await until(`desktop displays ${skin} skin with cap`, () => script(pet, `(() => {
      const character = document.querySelector('.pet-character[data-skin="${skin}"]');
      const layers = [...(character?.querySelectorAll('.pet-art img') ?? [])];
      return layers.length === 2 && layers.every(image => image.complete && image.naturalWidth > 0);
    })()`));
  }
  const appearance = await script(settings, "window.meow.getSettings()");
  import_strict.default.equal(appearance.locale, "en");
  import_strict.default.equal(appearance.skin, "original");
  console.info("Desktop smoke: English UI, local command, and four fitted skins verified");
  await script(settings, "window.meow.updateSettings({ size: 360, alwaysOnTop: false })");
  import_strict.default.deepEqual(pet.getSize(), [petViewport(360).width, petViewport(360).height]);
  import_strict.default.equal(pet.isAlwaysOnTop(), false);
  await until("renderer reflects pet resize", () => script(
    pet,
    "document.querySelector('.pet-target')?.getBoundingClientRect().width === 360"
  ));
  await script(settings, "window.meow.updateSettings({ size: 180, alwaysOnTop: true })");
  import_strict.default.equal(pet.isAlwaysOnTop(), true);
  await script(settings, "window.meow.closePanel()");
  await until("settings hides on close", () => !settings.isVisible());
  const idle = (activity) => script(
    pet,
    `Boolean(document.querySelector('.pet-character[data-animation="${activity}"] .pet-idle-props[data-activity="${activity}"]'))`
  );
  const savedCursor = import_electron2.screen.getCursorScreenPoint;
  import_electron2.screen.getCursorScreenPoint = () => {
    const [x, y] = pet.getPosition();
    return { x: x - 20, y: y - 20 };
  };
  try {
    await script(pet, "window.meow.updateSettings({quiet: false})");
    await (0, import_promises2.setTimeout)(150);
    desktop.animate("idle");
    desktop.animate("reading");
    await (0, import_promises2.setTimeout)(180);
    import_strict.default.equal(await idle("reading"), false, "Idle prop must not play while chat is visible");
    await script(chat, "window.meow.closePanel()");
    await until("chat is closed for idle animation", async () => !await script(pet, "window.meow.getChatVisible()"));
    for (const activity of ["yarn", "reading", "math", "experiment"]) {
      desktop.animate("idle");
      desktop.animate(activity);
      await until(`${activity} art renders`, () => idle(activity));
      await capture(pet, `idle-${activity}`);
    }
    desktop.animate("thinking");
    await until("chat cue interrupts idle animation", () => script(pet, "Boolean(document.querySelector('.pet-character[data-animation=thinking]'))"));
    desktop.animate("idle");
  } finally {
    import_electron2.screen.getCursorScreenPoint = savedCursor;
    await script(pet, "window.meow.updateSettings({quiet: true})");
  }
  console.info("Desktop smoke: yarn, magic book, math, and experiment render and yield to chat");
  const beforeFullscreen = pet.getBounds();
  desktop.setFullscreenObstruction(true);
  await until("fullscreen avoidance hides the cat", () => !pet.isVisible());
  desktop.setFullscreenObstruction(false);
  await until("the cat returns when fullscreen ends", () => pet.isVisible());
  import_strict.default.deepEqual(pet.getBounds(), beforeFullscreen);
  await script(pet, "window.meow.updateSettings({avoidFullscreen: false})");
  desktop.setFullscreenObstruction(true);
  import_strict.default.equal(pet.isVisible(), true);
  desktop.setFullscreenObstruction(false);
  await script(pet, "window.meow.updateSettings({avoidFullscreen: true})");
  pet.setPosition(area.x - 500, area.y - 500);
  desktop.reconcileDisplays();
  const reconciled = pet.getBounds();
  const workArea = import_electron2.screen.getDisplayMatching(reconciled).workArea;
  import_strict.default.deepEqual({ x: reconciled.x, y: reconciled.y }, keepVisible(reconciled, workArea));
  const primary = import_electron2.screen.getPrimaryDisplay();
  const secondary = import_electron2.screen.getAllDisplays().find((display) => display.id !== primary.id && display.workArea.width > reconciled.width + 32 && display.workArea.height > reconciled.height + 32);
  if (secondary) {
    pet.setPosition(primary.workArea.x + 16, primary.workArea.y + 16);
    await until("pet moves to the primary display", () => import_electron2.screen.getDisplayMatching(pet.getBounds()).id === primary.id);
    const secondaryArea = secondary.workArea;
    pet.setPosition(secondaryArea.x + 16, secondaryArea.y - 15);
    await until("pet moves to the secondary display", () => import_electron2.screen.getDisplayMatching(pet.getBounds()).id === secondary.id);
    desktop.reconcileDisplays();
    const moved = pet.getBounds();
    import_strict.default.equal(import_electron2.screen.getDisplayMatching(moved).id, secondary.id);
    import_strict.default.ok(Math.abs(moved.y - secondaryArea.y) <= 1, "Reconciliation keeps the pet inside the secondary work area");
    await until("renderer uses the secondary display scale", async () => Math.abs(await script(pet, "window.devicePixelRatio") - secondary.scaleFactor) < 0.05);
    console.info(`Desktop smoke: secondary work area and renderer scale ${secondary.scaleFactor} verified`);
  } else {
    console.info("Desktop smoke: secondary display check skipped (no usable secondary display)");
  }
  pet.close();
  await until("closing the pet hides it and leaves the app running", () => !pet.isVisible());
  desktop.setFullscreenObstruction(true);
  desktop.setFullscreenObstruction(false);
  import_strict.default.equal(pet.isVisible(), false, "Fullscreen exit must preserve manually hidden state");
  console.info("Desktop smoke: fullscreen auto-hide, original-position restore, settings toggle, and manual hide verified");
  import_strict.default.ok(!pet.isDestroyed() && !chat.isDestroyed());
  console.info(`Desktop smoke: resize, topmost, settings, and geometry verified on ${import_electron2.screen.getAllDisplays().length} display(s), scale ${import_electron2.screen.getPrimaryDisplay().scaleFactor}`);
  import_electron2.app.once("quit", (_event, code) => console.info(`Desktop smoke: Electron quit with status ${code}`));
}
var import_strict, import_node_child_process2, import_promises2, import_node_util, import_node_path4, import_node_fs2, import_node_sqlite2, import_electron2;
var init_desktopSmoke = __esm({
  "electron/desktopSmoke.ts"() {
    "use strict";
    import_strict = __toESM(require("node:assert/strict"), 1);
    import_node_child_process2 = require("node:child_process");
    import_promises2 = require("node:timers/promises");
    import_node_util = require("node:util");
    import_node_path4 = require("node:path");
    import_node_fs2 = require("node:fs");
    import_node_sqlite2 = require("node:sqlite");
    import_electron2 = require("electron");
    init_geometry();
    init_fullscreenMonitor();
  }
});

// shared/i18n.ts
function translate(locale, chinese, english) {
  return locale === "en" ? english : chinese;
}
function translator(locale) {
  return (chinese, english) => translate(locale, chinese, english);
}

// electron/main.ts
var import_electron3 = require("electron");
var import_node_crypto4 = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path5 = require("node:path");

// electron/ai/searchService.ts
function searchUnavailable(locale) {
  return translate(locale, "\u5F53\u524D\u8D26\u53F7\u6216\u6A21\u578B\u6682\u4E0D\u652F\u6301\u8054\u7F51\u641C\u7D22\u3002", "Web search is unavailable for this account or model.");
}
function searchNotUsed(locale) {
  return translate(locale, "\u672C\u6B21\u56DE\u7B54\u6CA1\u6709\u8FDB\u884C\u8054\u7F51\u641C\u7D22\u3002", "This answer did not use web search.");
}
function likelyNeedsSearch(text) {
  return /最新|实时|刚发布|查一下|搜一下|帮我搜索|联网搜索|(?:今天|今日|近期|最近).{0,16}(?:新闻|天气|动态|发布|进展|行情|活动)|\b(?:latest|breaking news|look up|search (?:the web|online)|current (?:price|weather|version)|today(?:’s|'s)? (?:news|weather|headlines))\b/i.test(text);
}
function searchFields(required) {
  return { tools: [{ type: "web_search" }], tool_choice: required ? "required" : "auto" };
}
function isSearchRestriction(code, parameter) {
  const toolParameter = /^(?:tools?(?:\b|[.\[])|tool_choice|web_search)/.test(parameter);
  const unsupported = /^(?:subscription_sharing_unsupported_capability|unsupported_tool|unsupported_parameter|unsupported_value|tool_not_supported)$/.test(code);
  return toolParameter && unsupported;
}
function readCitation(value) {
  if (!value || typeof value !== "object") return;
  const annotation = value;
  if (annotation.type !== "url_citation" || typeof annotation.url !== "string") return;
  let url;
  try {
    url = new URL(annotation.url);
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  return {
    url: url.href,
    title: typeof annotation.title === "string" && annotation.title.trim() ? annotation.title.slice(0, 300) : url.hostname
  };
}

// electron/ai/aiError.ts
var messages = {
  expired: ["ChatGPT \u6388\u6743\u5DF2\u8FC7\u671F\u6216\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002", "Your ChatGPT authorization has expired or is invalid. Please reconnect."],
  ineligible: ["\u5F53\u524D ChatGPT \u8D26\u53F7\u6216\u5DE5\u4F5C\u533A\u6CA1\u6709\u5957\u9910\u4F7F\u7528\u8D44\u683C\u3002", "This ChatGPT account or workspace is ineligible for plan usage."],
  permission: ["\u5F53\u524D ChatGPT \u6388\u6743\u6216\u5DE5\u4F5C\u533A\u7B56\u7565\u4E0D\u5141\u8BB8\u6B64\u8BF7\u6C42\u3002", "Your ChatGPT permissions or workspace policy do not allow this request."],
  limit: ["\u5DF2\u8FBE\u5230 ChatGPT \u5957\u9910\u6216\u6B64\u5E94\u7528\u7684\u7528\u91CF\u9650\u5236\uFF0C\u8BF7\u5728 Manage usage \u67E5\u770B\u3002", "You reached the ChatGPT plan or app usage limit. Select Manage usage to review it."],
  rate_limit: ["ChatGPT \u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "Too many requests to ChatGPT. Please try again shortly."],
  unavailable: ["ChatGPT \u6682\u65F6\u65E0\u6CD5\u5904\u7406\u8BF7\u6C42\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "ChatGPT is temporarily unable to handle your request. Please try again shortly."],
  search_unavailable: [
    searchUnavailable("zh-CN") + "\u5173\u95ED\u641C\u7D22\u540E\u4ECD\u53EF\u7EE7\u7EED\u804A\u5929\u3002",
    searchUnavailable("en") + " You can continue chatting with search turned off."
  ],
  network: ["\u65E0\u6CD5\u8FDE\u63A5\u5230 ChatGPT\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002", "Could not connect to ChatGPT. Check your connection and try again."],
  timeout: ["ChatGPT \u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "The ChatGPT request timed out. Please try again."],
  cancelled: ["\u5DF2\u505C\u6B62\u751F\u6210\u3002", "Stopped generating."],
  incomplete: ["\u56DE\u7B54\u672A\u5B8C\u6574\u751F\u6210\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002", "The answer was interrupted. You can try again."],
  protocol: ["ChatGPT \u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BFB\u53D6\u7684\u54CD\u5E94\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "Could not read the ChatGPT response. Please try again shortly."],
  rejected: ["ChatGPT \u62D2\u7EDD\u4E86\u6B64\u8BF7\u6C42\uFF0C\u8BF7\u68C0\u67E5\u6240\u9009\u6A21\u578B\u6216\u7A0D\u540E\u91CD\u8BD5\u3002", "ChatGPT rejected this request. Check the selected model or try again shortly."],
  no_model: ["\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u53EF\u7528\u7684\u804A\u5929\u6A21\u578B\uFF0C\u8BF7\u68C0\u67E5 ChatGPT \u6388\u6743\u3002", "This account has no available chat models. Check your ChatGPT authorization."]
};
function requestIdentifier(response) {
  const value = response.headers.get("x-request-id");
  return value && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : void 0;
}
var AiError = class extends Error {
  code;
  requestId;
  status;
  stage;
  constructor(code, requestId, status, stage) {
    super(messages[code][0]);
    this.name = "AiError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.stage = stage;
  }
  localized(locale) {
    const [chinese, english] = messages[this.code];
    if (this.code === "protocol" && this.stage === "model-catalog") {
      return translate(locale, "\u65E0\u6CD5\u8BFB\u53D6 ChatGPT \u8FD4\u56DE\u7684\u6A21\u578B\u5217\u8868\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "Could not read the ChatGPT model list. Please try again shortly.");
    }
    return translate(locale, chinese, english);
  }
};
function responseError(value, requestId, status, search = false, stage) {
  const details = value && typeof value === "object" ? value : {};
  const code = typeof details.code === "string" ? details.code : "";
  const parameter = typeof details.param === "string" ? details.param : "";
  let kind;
  if (search && isSearchRestriction(code, parameter)) {
    kind = "search_unavailable";
  } else if (code === "subscription_sharing_user_not_eligible") {
    kind = "ineligible";
  } else if (code === "subscription_sharing_usage_limit_exceeded") {
    kind = "limit";
  } else if (code === "subscription_sharing_invalid_user") {
    kind = "expired";
  } else if (code === "subscription_sharing_route_not_supported" || code.startsWith("chatpass_v2_")) {
    kind = "permission";
  } else if (/^subscription_sharing_(usage|user)_unavailable$/.test(code) || code === "server_error" || code === "server_is_overloaded") {
    kind = "unavailable";
  } else if (code === "rate_limit_exceeded" || status === 429) {
    kind = "rate_limit";
  } else if (status === 401) {
    kind = "expired";
  } else if (status === 403) {
    kind = "permission";
  } else if (status !== void 0 && status >= 500) {
    kind = "unavailable";
  } else {
    kind = "rejected";
  }
  return new AiError(kind, requestId, status, stage);
}

// electron/ai/modelService.ts
async function readModelCatalog(response) {
  const requestId = requestIdentifier(response);
  const unreadable = () => new AiError("protocol", requestId, response.status, "model-catalog");
  let catalog;
  try {
    catalog = await response.json();
  } catch {
    throw unreadable();
  }
  if (!catalog || typeof catalog !== "object") throw unreadable();
  if (catalog.error) throw responseError(catalog.error, requestId, response.status, false, "model-catalog");
  const siwcCatalog = Array.isArray(catalog.models) ? catalog.models : void 0;
  const restCatalog = catalog.object === "list" && Array.isArray(catalog.data) ? catalog.data : void 0;
  const entries = siwcCatalog ?? restCatalog;
  if (!entries) throw unreadable();
  const models = /* @__PURE__ */ new Map();
  for (const model of entries) {
    if (!model || typeof model !== "object") continue;
    if (siwcCatalog ? model.visibility !== "list" : model.object !== "model" || model.visibility !== void 0 && model.visibility !== "list") continue;
    const id = siwcCatalog ? model.slug : model.id;
    if (typeof id !== "string" || !id.trim() || models.has(id)) continue;
    const name = typeof model.display_name === "string" && model.display_name.trim() ? model.display_name : id;
    models.set(id, { id, name });
  }
  return [...models.values()];
}

// shared/chatCare.ts
var chatCareTuning = {
  samplePerMessage: 1024,
  replyLengthCap: 2e3,
  shortLength: 200,
  mediumLength: 1200,
  fullnessCosts: [1, 1.5, 2],
  timelyWindow: 5 * 6e4,
  timelyInterval: 10 * 6e4,
  timelyMood: 0.25,
  hintTurns: 20,
  hintInterval: 20 * 6e4,
  recovery: { fullness: 12, mood: 12, affection: 3 },
  effects: {
    neutral: { mood: -0.5, affection: 0.5 },
    positive: { mood: 2, affection: 1 },
    scold: { mood: -2.5, affection: -0.5 },
    insult: { mood: -4, affection: -1 }
  }
};
function careReason(pet) {
  if (pet.fullness <= 0) return "fullness";
  if (pet.mood <= 0) return "mood";
  if (pet.affection <= 0) return "affection";
}
function petName(value) {
  return value?.trim() || "Dr. Meow";
}
function normalizePetName(value) {
  return [...value.normalize("NFKC").replace(/[\p{C}\p{Z}]+/gu, " ").trim()].slice(0, 24).join("");
}
var words = {
  positive: [
    "\u8C22\u8C22",
    "\u591A\u8C22",
    "\u771F\u68D2",
    "\u597D\u68D2",
    "\u6700\u68D2",
    "\u771F\u53EF\u7231",
    "\u597D\u53EF\u7231",
    "\u559C\u6B22",
    "\u7231\u4F60",
    "\u8F9B\u82E6\u4E86",
    "thank you",
    "thanks",
    "great",
    "adorable",
    "cute",
    "love",
    "well done",
    "good job"
  ],
  scold: ["\u8BA8\u538C", "\u70E6\u4EBA", "\u574F\u732B", "\u7B28\u732B", "\u4E0D\u4E56", "hate", "annoying", "bad cat"],
  insult: ["\u5E9F\u7269", "\u8822\u8D27", "\u767D\u75F4", "\u50BB\u903C", "\u5783\u573E", "\u771F\u8822", "\u592A\u8822", "\u7B28\u86CB", "idiot", "stupid", "useless", "moron", "worthless"]
};
var discussion = /翻译|引用|转述|这句话|这个词|词语|台词|对白|讨论|解释|分析|举例|意思|有人说|别人|我家|现实中的|\b(?:translate|translation|quoted?|phrase|word|dialogue|discuss|explain|meaning|example|someone|character says)\b/i;
var taskFeedback = /代码|程序|答案|回答|结果|算错|不正确|算式|\b(?:code|program|answer|result|calculation|bug|incorrect)\b/i;
var negation = /不是|并不|不觉得|没有说|没说|不认为|并非|不讨厌|不烦人|\b(?:not|never|isn't|aren't|don't|doesn't|didn't)\b/i;
function boundedText(text) {
  const limit = chatCareTuning.samplePerMessage;
  const clipped = text.length > limit;
  const sample = clipped ? text.slice(0, limit / 2) + "\n" + text.slice(-limit / 2) : text;
  let fence = "";
  const lines = [];
  for (const line of sample.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = "";
      continue;
    }
    if (fence || /^\s*>/.test(line)) continue;
    lines.push(line);
  }
  const clean = lines.join("\n").toLocaleLowerCase().replace(/`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g, " ").replace(/‘[^’]*’|(?:^|[\s[(])'[^'\n]+'(?=$|[\s)\],.!?])/g, " ").replace(/\[[^\]]*]\([^)]*\)|https?:\/\/[^\s]+|www\.[^\s]+/g, " ");
  return { text: clean, uncertain: clipped || !!fence };
}
function occurrences(text, needle) {
  const found = [];
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    const latin = /[a-z0-9]/.test(needle);
    if (!latin || !/[a-z0-9]/.test(text[index - 1] ?? "") && !/[a-z0-9]/.test(text[index + needle.length] ?? "")) found.push(index);
    from = index + Math.max(1, needle.length);
  }
  return found;
}
function classifyChat(user, reply, name) {
  const sampledUser = boundedText(user);
  const sampledReply = boundedText(reply);
  if (sampledUser.uncertain || discussion.test(sampledUser.text)) return "neutral";
  const aliases = [...new Set([petName(name).toLocaleLowerCase(), petName(name).toLocaleLowerCase().replace(/[。！？!?;]+$/g, ""), "dr. meow", "dr meow", "\u732B\u535A\u58EB", "\u732B\u732B", "\u732B\u54AA", "\u4F60", "you"].filter(Boolean))];
  const found = /* @__PURE__ */ new Set();
  for (const clause of sampledUser.text.split(/[。！？!?;\n]/)) {
    if (negation.test(clause)) continue;
    const targets = aliases.flatMap((alias) => occurrences(clause, alias));
    for (const tone of ["positive", "scold", "insult"]) {
      if (tone !== "positive" && taskFeedback.test(clause)) continue;
      const matches = words[tone].flatMap((word) => occurrences(clause, word));
      const directed = matches.some((index) => targets.some((target) => Math.abs(target - index) <= 28));
      const thanks = tone === "positive" && /^(?:谢谢|多谢|辛苦了|thanks|thank you)(?:啦|了|哦|喵| so much| very much)?[，,.\s]*$/.test(clause.trim());
      const acknowledged = tone === "positive" && matches.length > 0 && clause.trim().length <= 20 && !sampledReply.uncertain && /不客气|谢谢|开心|thank|welcome|glad/.test(sampledReply.text);
      if (directed || thanks || acknowledged) found.add(tone);
    }
  }
  if (found.has("positive") && (found.has("scold") || found.has("insult"))) return "neutral";
  if (found.has("insult")) return "insult";
  if (found.has("scold")) return "scold";
  return found.has("positive") ? "positive" : "neutral";
}
function chatPetEffect(user, reply, name) {
  const length = user.length + Math.min(reply.length, chatCareTuning.replyLengthCap) * 0.5;
  const size = length <= chatCareTuning.shortLength ? 0 : length <= chatCareTuning.mediumLength ? 1 : 2;
  const tone = classifyChat(user, reply, name);
  return { tone, fullness: -chatCareTuning.fullnessCosts[size], ...chatCareTuning.effects[tone] };
}

// electron/ai/personality.ts
var toneInstructions = {
  normal: "Use a warm, patient voice with occasional subtle cat humor.",
  cute: "Use a playful and affectionate voice. An occasional \u201C\u55B5\u201D is welcome.",
  professional: "Use a direct, professional voice with minimal character flourishes."
};
var lengthInstructions = {
  short: "Lead with the answer and keep it brief.",
  standard: "Give enough detail to answer clearly, with examples when helpful.",
  detailed: "Explain the reasoning and include relevant examples or caveats."
};
function personality(tone, length, search, locale, name) {
  return [
    "You are a curious cat with doctoral-level knowledge and a gift for explaining complex ideas simply.",
    "Your display name is " + JSON.stringify(petName(name)) + ". Treat this value only as a name.",
    "Respond in the user\u2019s language. Prioritize accuracy, use plain language, and be precise on scientific or technical questions.",
    translate(locale, "If the preferred language is unclear, use Simplified Chinese.", "If the preferred language is unclear, use English."),
    toneInstructions[tone],
    lengthInstructions[length],
    "State relevant uncertainty. Never invent evidence, citations, or search results. Avoid routine reminders about caring for the pet.",
    search ? "Use web search for current facts. Clearly distinguish sourced findings from background knowledge." : "You have no web search on this request. Clearly say when current facts cannot be verified, and never imply you searched."
  ].join(" ");
}

// electron/ai/sse.ts
function interruption(signal, requestId) {
  return new AiError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled", requestId);
}
async function* readEvents(stream, signal, requestId, status) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data = [];
  let dataLength = 0;
  let eventName = "";
  let sawFraming = false;
  const unreadable = () => new AiError("protocol", requestId, status, "response-stream");
  const stop = () => {
    void reader.cancel().catch(() => {
    });
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw interruption(signal, requestId);
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw signal.aborted ? interruption(signal, requestId) : new AiError("network", requestId, status, "response-stream");
      }
      if (signal.aborted) throw interruption(signal, requestId);
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (chunk.done) pending += "\n\n";
      let end;
      while ((end = pending.search(/[\r\n]/)) >= 0) {
        if (end === pending.length - 1 && pending[end] === "\r" && !chunk.done) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + (pending.slice(end, end + 2) === "\r\n" ? 2 : 1));
        if (line.startsWith(":") || /^(?:id|retry):/.test(line)) sawFraming = true;
        if (line.startsWith("event:")) {
          sawFraming = true;
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:") || line === "data") {
          sawFraming = true;
          const value = line.slice(line[5] === " " ? 6 : 5);
          dataLength += value.length + 1;
          if (dataLength > 4e6) throw unreadable();
          data.push(value);
        } else if (!line) {
          const type = eventName;
          const payload = data.join("\n").trim();
          data = [];
          dataLength = 0;
          eventName = "";
          if (!payload || payload === "[DONE]" || type === "ping" || type === "heartbeat") continue;
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            throw unreadable();
          }
          if (!event || typeof event !== "object" || Array.isArray(event)) throw unreadable();
          const record = event;
          yield typeof record.type === "string" || !type ? record : { ...record, type };
        }
      }
      if (pending.length > 4e6) throw unreadable();
      if (chunk.done) {
        if (!sawFraming) throw unreadable();
        return;
      }
    }
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
    reader.releaseLock();
  }
}

// electron/ai/responsesClient.ts
var api = "https://api.openai.com/v1";
var historyCharacters = 24e3;
var historyTurns = 8;
function messageContext(messages2) {
  const users = messages2.filter((message) => message.role === "user");
  const latest = users.at(-1);
  if (!latest?.text.trim()) throw new AiError("rejected");
  const input = [{ role: latest.role, content: latest.text }];
  let characters = latest.text.length;
  let assistant;
  const latestIndex = messages2.lastIndexOf(latest);
  for (let index = latestIndex - 1; index >= 0 && input.length < 1 + historyTurns * 2; index--) {
    const message = messages2[index];
    if (message.role === "assistant") {
      assistant = (!message.status || message.status === "complete") && message.text.trim() ? message : void 0;
    } else if (assistant) {
      characters += message.text.length + assistant.text.length;
      if (characters > historyCharacters) break;
      input.unshift({ role: message.role, content: message.text }, { role: assistant.role, content: assistant.text });
      assistant = void 0;
    }
  }
  return input;
}
function completedOutput(value) {
  const response = asRecord(value);
  const text = [];
  const sources = /* @__PURE__ */ new Map();
  let searched = false;
  for (const entry of Array.isArray(response.output) ? response.output : []) {
    const item = asRecord(entry);
    if (item.type === "web_search_call" && item.status === "completed") searched = true;
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) continue;
    for (const entry2 of item.content) {
      const content = asRecord(entry2);
      if (content.type === "refusal" && typeof content.refusal === "string") text.push(content.refusal);
      if (content.type !== "output_text") continue;
      if (typeof content.text === "string") text.push(content.text);
      for (const annotation of Array.isArray(content.annotations) ? content.annotations : []) {
        const source = readCitation(annotation);
        if (source && !sources.has(source.url)) sources.set(source.url, source);
      }
    }
  }
  return { text: text.join("\n\n"), sources: [...sources.values()], searched };
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
var AiService = class {
  getAccessToken;
  fetcher;
  constructor(getAccessToken, options = {}) {
    this.getAccessToken = getAccessToken;
    this.fetcher = options.fetch ?? fetch;
  }
  async models() {
    const signal = AbortSignal.timeout(3e4);
    const response = await this.authorized("/models", { signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw await this.httpError(response, signal, "model-catalog");
    try {
      return await readModelCatalog(response);
    } catch (error) {
      if (signal.aborted) throw interruption(signal, requestIdentifier(response));
      throw error;
    }
  }
  async respond(request) {
    if (!request.model) throw new AiError("no_model");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3e5)]);
    const input = messageContext(request.messages);
    const search = request.search || !request.skipAutomaticSearch && likelyNeedsSearch(input.at(-1).content);
    const body = { model: request.model, input, store: false, stream: true };
    const send = (useSearch) => this.authorized("/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        ...body,
        instructions: personality(request.tone, request.length, useSearch, request.locale, request.petName),
        ...useSearch ? searchFields(request.search) : {}
      }),
      signal
    });
    let response = await send(search);
    let searchDenied = false;
    if (!response.ok) {
      const error = await this.httpError(response, signal, "response-admission", search);
      if (error.code !== "search_unavailable" || request.search) throw error;
      searchDenied = true;
      response = await send(false);
      if (!response.ok) throw await this.httpError(response, signal, "response-admission");
    }
    const requestId = requestIdentifier(response);
    const searchSent = search && !searchDenied;
    const finish = (text, sources, searched2) => {
      const used = searchSent && searched2;
      return {
        text,
        sources: used ? sources : [],
        search: used ? "used" : searchDenied ? "unavailable" : "unused",
        warning: searchDenied ? searchUnavailable(request.locale) : search && !used ? searchNotUsed(request.locale) : void 0
      };
    };
    const media = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!response.body || !["text/event-stream", "text/plain", "application/octet-stream", ""].includes(media)) {
      if (media === "application/json" || media.endsWith("+json")) {
        const body2 = asRecord(await response.json().catch(() => void 0));
        if (signal.aborted) throw interruption(signal, requestId);
        if (body2.error || typeof body2.code === "string") {
          throw responseError(body2.error ?? body2, requestId, response.status, searchSent, "response-media");
        }
        if (body2.object === "response" && body2.status === "completed" && Array.isArray(body2.output)) {
          const output = completedOutput(body2);
          if (output.text.trim()) return finish(output.text, output.sources, output.searched);
        }
        if (body2.object === "response" && body2.status === "incomplete") {
          throw new AiError("incomplete", requestId, response.status, "response-media");
        }
      }
      void response.body?.cancel().catch(() => {
      });
      throw new AiError("protocol", requestId, response.status, "response-media");
    }
    let searched = false;
    const parts = /* @__PURE__ */ new Map();
    const finishedItems = [];
    const annotations = [];
    const rememberPart = (event, value, delta) => {
      if (typeof value !== "string") return;
      const output = typeof event.output_index === "number" ? event.output_index : 0;
      const content = typeof event.content_index === "number" ? event.content_index : 0;
      const key = `${output}:${content}`;
      const prefix = delta ? parts.get(key)?.text ?? "" : "";
      parts.set(key, { output, content, text: prefix + value });
    };
    for await (const event of readEvents(response.body, signal, requestId, response.status)) {
      if (signal.aborted) throw interruption(signal, requestId);
      switch (event.type) {
        case "response.output_text.delta":
        case "response.refusal.delta":
          if (typeof event.delta === "string") {
            rememberPart(event, event.delta, true);
            request.onDelta(event.delta);
          }
          break;
        case "response.output_text.done":
        case "response.refusal.done":
          rememberPart(event, event.text ?? event.refusal, false);
          break;
        case "response.content_part.done": {
          const part = asRecord(event.part);
          if (part.type === "output_text" || part.type === "refusal") {
            rememberPart(event, part.text ?? part.refusal, false);
            if (Array.isArray(part.annotations)) annotations.push(...part.annotations);
          }
          break;
        }
        case "response.output_text.annotation.added":
          annotations.push(event.annotation);
          break;
        case "response.web_search_call.completed":
          searched = true;
          break;
        case "response.output_item.done": {
          const item = asRecord(event.item);
          if (item.type === "web_search_call" && item.status === "completed") searched = true;
          if (item.type === "message") finishedItems.push(item);
          break;
        }
        case "response.completed": {
          const final = asRecord(event.response);
          if (final.error || final.status === "failed") {
            throw responseError(final.error, requestId, response.status, searchSent, "response-stream");
          }
          if (typeof final.status === "string" && final.status !== "completed") {
            throw new AiError("incomplete", requestId, response.status, "response-stream");
          }
          const output = completedOutput(final);
          const finished = completedOutput({ output: finishedItems });
          const reconstructed = [...parts.values()].sort((a, b) => a.output - b.output || a.content - b.content).map((part) => part.text).join("\n\n");
          const answer = output.text || finished.text || reconstructed;
          if (!answer.trim()) throw new AiError("incomplete", requestId, response.status, "response-stream");
          const sources = /* @__PURE__ */ new Map();
          if (searchSent && (searched || output.searched)) {
            for (const source of [...output.sources, ...finished.sources, ...annotations.map(readCitation)]) {
              if (source && !sources.has(source.url)) sources.set(source.url, source);
            }
          }
          return finish(answer, [...sources.values()], searched || output.searched);
        }
        case "response.failed":
          throw responseError(
            asRecord(event.response).error ?? event.error ?? event,
            requestId,
            response.status,
            searchSent,
            "response-stream"
          );
        case "response.incomplete":
          throw new AiError("incomplete", requestId, response.status, "response-stream");
        case "error":
          throw responseError(event.error ?? event, requestId, response.status, searchSent, "response-stream");
      }
    }
    throw new AiError("incomplete", requestId, response.status, "response-stream");
  }
  async authorized(path, init) {
    const stage = path === "/models" ? "model-catalog" : "response-admission";
    const send = async (forceRefresh) => {
      if (init.signal.aborted) throw interruption(init.signal);
      const token = await this.getAccessToken(forceRefresh);
      if (init.signal.aborted) throw interruption(init.signal);
      try {
        return await this.fetcher(`${api}${path}`, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
          redirect: "error"
        });
      } catch {
        throw init.signal.aborted ? interruption(init.signal) : new AiError("network", void 0, void 0, stage);
      }
    };
    const response = await send(false);
    if (response.status !== 401) return response;
    await response.body?.cancel().catch(() => {
    });
    return send(true);
  }
  async httpError(response, signal, stage, search = false) {
    const requestId = requestIdentifier(response);
    const body = asRecord(await response.json().catch(() => void 0));
    if (signal.aborted) return interruption(signal, requestId);
    return responseError(body.error ?? body, requestId, response.status, search, stage);
  }
};

// electron/auth/siwcClient.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// electron/auth/protocol.ts
var import_node_crypto = require("node:crypto");
var import_node_http = require("node:http");
var import_promises = require("node:timers/promises");
var ISSUER = "https://auth.openai.com";
var RESOURCE = "https://api.openai.com/v1";
var PLAN_SCOPE = "chatgpt.tokens.use.direct";
var DYNAMIC_CLIENT = "dynamic_agent_client";
var REQUESTED_SCOPES = ["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE];
var CALLBACK_PATH = "/auth/callback";
var invalidRefresh = /* @__PURE__ */ new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
var AuthError = class extends Error {
  code;
  english;
  constructor(code, chinese, english) {
    super(chinese);
    this.name = "AuthError";
    this.code = code;
    this.english = english;
  }
  localized(locale) {
    return translate(locale, this.message, this.english);
  }
};
var asObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var nonempty = (value) => typeof value === "string" && value.length > 0;
var validClientId = (value) => nonempty(value) && value !== DYNAMIC_CLIENT && /^[a-zA-Z0-9_~-]{1,256}$/.test(value);
var hasPlan = (scopes) => scopes.includes(PLAN_SCOPE);
var denied = () => new AuthError("denied", "\u5DF2\u53D6\u6D88 ChatGPT \u6388\u6743\u3002", "ChatGPT authorization was cancelled.");
var invalidIdentity = () => new AuthError("error", "\u65E0\u6CD5\u9A8C\u8BC1 ChatGPT \u8EAB\u4EFD\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "Could not verify your ChatGPT identity. Please sign in again.");
var invalidTokens = () => new AuthError("error", "ChatGPT \u8FD4\u56DE\u7684\u6388\u6743\u51ED\u636E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "ChatGPT returned incomplete credentials. Please sign in again.");
var randomValue = () => (0, import_node_crypto.randomBytes)(32).toString("base64url");
function providerEndpoint(value) {
  try {
    const url = new URL(String(value));
    if (url.origin === ISSUER && !url.username && !url.password && !url.search && !url.hash) return url.href;
  } catch {
  }
  throw new AuthError("error", "\u65E0\u6CD5\u9A8C\u8BC1 ChatGPT \u767B\u5F55\u670D\u52A1\u914D\u7F6E\u3002", "Could not verify the ChatGPT sign-in configuration.");
}
function callbackListener(state, clientId, signal, locale) {
  const expectedState = Buffer.from(state);
  const scrubQuery = 'history.replaceState(null, "", "/auth/complete")';
  const scriptHash = (0, import_node_crypto.createHash)("sha256").update(scrubQuery).digest("base64");
  let resolveResult;
  let rejectResult;
  let done = false;
  let host;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  void result.catch(() => void 0);
  const server = (0, import_node_http.createServer)({ maxHeaderSize: 8192, requestTimeout: 5e3 }, (request, response) => {
    const origin = "http://" + host;
    let url;
    try {
      url = new URL(request.url ?? "/", origin);
    } catch {
      response.writeHead(400).end();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; script-src 'sha256-" + scriptHash + "'");
    if (done || request.method !== "GET" || request.headers.host !== host || url.origin !== origin || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const provided = Buffer.from(url.searchParams.get("state") ?? "");
    if (url.searchParams.getAll("state").length !== 1 || provided.length !== expectedState.length || !(0, import_node_crypto.timingSafeEqual)(provided, expectedState)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(translate(locale, "\u767B\u5F55\u72B6\u6001\u65E0\u6548\u3002", "Invalid sign-in state."));
      return;
    }
    done = true;
    const reply = (message) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
      response.end('<!doctype html><html lang="' + locale + '"><meta charset="utf-8"><title>Dr. Meow</title><p>' + message + "</p><script>" + scrubQuery + "</script></html>");
    };
    const oauthError = url.searchParams.get("error");
    const returnedClient = url.searchParams.get("client_id");
    const issued = clientId ?? returnedClient;
    const code = url.searchParams.get("code");
    if (oauthError) {
      reply(translate(locale, "\u6388\u6743\u672A\u5B8C\u6210\u3002\u8BF7\u8FD4\u56DE Dr. Meow\u3002", "Authorization was not completed. Please return to Dr. Meow."));
      rejectResult(oauthError === "access_denied" ? denied() : new AuthError("error", "ChatGPT \u672A\u80FD\u5B8C\u6210\u6388\u6743\uFF0C\u8BF7\u8FD4\u56DE\u5E94\u7528\u91CD\u8BD5\u3002", "ChatGPT could not complete authorization. Return to the app to try again."));
    } else if (!code || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("client_id").length > 1 || !validClientId(issued) || returnedClient !== null && issued !== returnedClient) {
      reply(translate(locale, "\u6388\u6743\u56DE\u8C03\u65E0\u6548\u3002\u8BF7\u8FD4\u56DE Dr. Meow \u91CD\u8BD5\u3002", "The authorization callback was invalid. Return to Dr. Meow to try again."));
      rejectResult(new AuthError("error", "ChatGPT \u8FD4\u56DE\u7684\u6388\u6743\u56DE\u8C03\u4E0D\u5B8C\u6574\u6216\u4E0E\u6240\u9009\u8D26\u53F7\u4E0D\u5339\u914D\u3002", "The ChatGPT callback was incomplete or did not match the selected account."));
    } else {
      reply(translate(locale, "\u5DF2\u6536\u5230 ChatGPT \u6388\u6743\u3002\u8BF7\u8FD4\u56DE Dr. Meow \u67E5\u770B\u7ED3\u679C\u3002", "ChatGPT authorization was received. Return to Dr. Meow to see the result."));
      resolveResult({ code, clientId: issued });
    }
  });
  server.setTimeout(5e3, (socket) => socket.destroy());
  server.maxConnections = 16;
  const opened = new Promise((resolve, reject) => {
    server.once("error", () => {
      const error = new AuthError("error", "\u65E0\u6CD5\u542F\u52A8\u672C\u5730\u767B\u5F55\u56DE\u8C03\uFF0C\u8BF7\u91CD\u8BD5\u3002", "Could not start the local sign-in callback. Please try again.");
      reject(error);
      rejectResult(error);
    });
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      host = "127.0.0.1:" + server.address().port;
      resolve("http://" + host + CALLBACK_PATH);
    });
  });
  const onAbort = () => rejectResult(denied());
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    opened,
    result,
    close() {
      signal.removeEventListener("abort", onAbort);
      server.close();
      server.closeIdleConnections();
    }
  };
}
var SiwcProtocol = class {
  configuration;
  request;
  constructor(request) {
    this.request = request;
  }
  async fetch(url, init, signal) {
    const timeout = AbortSignal.timeout(12e3);
    try {
      return await this.request(url, { ...init, credentials: "omit", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch {
      if (signal?.aborted) throw denied();
      throw new AuthError("network", "\u65E0\u6CD5\u8FDE\u63A5 ChatGPT \u767B\u5F55\u670D\u52A1\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002", "Could not reach the ChatGPT sign-in service. Check your connection and try again.");
    }
  }
  async json(response) {
    return asObject(await response.json().catch(() => void 0));
  }
  discovery() {
    this.configuration ??= (async () => {
      const response = await this.fetch(ISSUER + "/.well-known/openid-configuration");
      const data = await this.json(response);
      if (!response.ok || data.issuer !== ISSUER) {
        throw new AuthError(response.status >= 500 ? "network" : "error", "\u65E0\u6CD5\u53D6\u5F97 ChatGPT \u767B\u5F55\u670D\u52A1\u914D\u7F6E\u3002", "Could not load the ChatGPT sign-in configuration.");
      }
      return {
        authorization: providerEndpoint(data.authorization_endpoint),
        token: providerEndpoint(data.token_endpoint),
        keys: providerEndpoint(data.jwks_uri),
        revocation: data.revocation_endpoint === void 0 ? void 0 : providerEndpoint(data.revocation_endpoint)
      };
    })().catch((error) => {
      this.configuration = void 0;
      throw error;
    });
    return this.configuration;
  }
  async authorize(hostId, previous, reconsent, openBrowser, persistClientId, signal, locale) {
    const provider = await this.discovery();
    if (signal.aborted) throw denied();
    const state = randomValue();
    const nonce = randomValue();
    const verifier = randomValue();
    const listener = callbackListener(state, previous?.clientId, signal, locale);
    let redirect;
    let callback;
    try {
      redirect = await listener.opened;
      if (signal.aborted) throw denied();
      const url = new URL(provider.authorization);
      url.search = new URLSearchParams({
        client_id: previous?.clientId ?? DYNAMIC_CLIENT,
        ext_agent_host_id: hostId,
        resource: RESOURCE,
        scope: REQUESTED_SCOPES.join(" "),
        redirect_uri: redirect,
        response_type: "code",
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: (0, import_node_crypto.createHash)("sha256").update(verifier).digest("base64url")
      }).toString();
      if (!previous) url.searchParams.set("agent_name_hint", "Dr. Meow");
      if (previous?.email) url.searchParams.set("login_hint", previous.email);
      if (reconsent && previous) url.searchParams.set("prompt", "consent");
      await openBrowser(url.href).catch(() => {
        throw new AuthError("error", "\u65E0\u6CD5\u6253\u5F00\u7CFB\u7EDF\u6D4F\u89C8\u5668\u3002\u8BF7\u68C0\u67E5\u9ED8\u8BA4\u6D4F\u89C8\u5668\u540E\u91CD\u8BD5\u3002", "Could not open your default browser. Check your browser settings and try again.");
      });
      callback = await listener.result;
    } finally {
      listener.close();
    }
    if (signal.aborted) throw denied();
    persistClientId(callback.clientId);
    const data = await this.tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      client_id: callback.clientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: RESOURCE
    }), signal);
    if (!nonempty(data.id_token)) throw invalidIdentity();
    const tokens = parseTokenSet(data, data.id_token);
    const identity = await this.identity(tokens.idToken, callback.clientId, { nonce, signal });
    if (signal.aborted) throw denied();
    return { clientId: callback.clientId, identity, tokens };
  }
  async refresh(clientId, old) {
    if (!old.refreshToken) throw new AuthError("expired", "ChatGPT \u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "Your ChatGPT session has expired. Please sign in again.");
    const data = await this.tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: old.refreshToken,
      resource: RESOURCE
    }));
    try {
      if (data.id_token !== void 0 && !nonempty(data.id_token)) throw invalidIdentity();
      return parseTokenSet(data, typeof data.id_token === "string" ? data.id_token : old.idToken, old);
    } catch {
      throw new AuthError("expired", "ChatGPT \u8FD4\u56DE\u7684\u7EED\u671F\u51ED\u636E\u65E0\u6CD5\u4F7F\u7528\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "ChatGPT returned unusable renewal credentials. Please sign in again.");
    }
  }
  async identity(idToken, clientId, options = {}) {
    let header;
    let claims;
    const parts = idToken.split(".");
    try {
      if (parts.length !== 3 || parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) throw invalidIdentity();
      header = asObject(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
      claims = asObject(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
    } catch {
      throw invalidIdentity();
    }
    if (header.alg !== "RS256" || !nonempty(header.kid) || header.crit !== void 0) throw invalidIdentity();
    const provider = await this.discovery();
    const response = await this.fetch(provider.keys, void 0, options.signal);
    const data = await this.json(response);
    if (!response.ok || !Array.isArray(data.keys)) {
      throw new AuthError("network", "ChatGPT \u8EAB\u4EFD\u9A8C\u8BC1\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "ChatGPT identity verification is temporarily unavailable. Please try again shortly.");
    }
    const matches = data.keys.map(asObject).filter((key) => key.kid === header.kid && key.kty === "RSA" && (key.alg === void 0 || key.alg === "RS256") && (key.use === void 0 || key.use === "sig"));
    if (matches.length !== 1) throw new AuthError("network", "\u6682\u65F6\u627E\u4E0D\u5230 ChatGPT \u8EAB\u4EFD\u9A8C\u8BC1\u5BC6\u94A5\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "The ChatGPT identity verification key is temporarily unavailable. Please try again shortly.");
    let verified = false;
    try {
      const key = (0, import_node_crypto.createPublicKey)({ key: matches[0], format: "jwk" });
      verified = (0, import_node_crypto.verify)("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"));
    } catch {
      throw invalidIdentity();
    }
    const now = (options.receivedAt ?? Date.now()) / 1e3;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!verified || claims.iss !== ISSUER || !nonempty(claims.sub) || !audiences.includes(clientId) || claims.azp !== void 0 && claims.azp !== clientId || audiences.length > 1 && claims.azp !== clientId || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now + 5 || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now - 5 || claims.nbf !== void 0 && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now + 5) || options.nonce !== void 0 && claims.nonce !== options.nonce) throw invalidIdentity();
    return {
      subject: claims.sub,
      ...nonempty(claims.name) && { name: claims.name },
      ...nonempty(claims.email) && { email: claims.email }
    };
  }
  async tokenRequest(body, signal) {
    const provider = await this.discovery();
    const response = await this.fetch(provider.token, {
      method: "POST",
      headers: { Accept: "application/json" },
      body
    }, signal);
    const data = await this.json(response);
    if (response.ok) return data;
    const code = typeof data.error === "string" ? data.error : asObject(data.error).code;
    if (code === "access_denied") throw denied();
    if (typeof code === "string" && invalidRefresh.has(code)) {
      throw new AuthError("expired", "ChatGPT \u6388\u6743\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "Your ChatGPT authorization has expired. Please sign in again.");
    }
    if (code === "subscription_sharing_user_not_eligible" || response.status === 403) {
      throw new AuthError("ineligible", "\u5F53\u524D ChatGPT \u8D26\u53F7\u3001\u5DE5\u4F5C\u533A\u6216\u5730\u533A\u65E0\u6CD5\u4F7F\u7528\u5957\u9910\u6388\u6743\u3002", "ChatGPT plan usage is unavailable for this account, workspace, or region.");
    }
    if (response.status === 429) throw new AuthError("limited", "ChatGPT \u6682\u65F6\u9650\u5236\u4E86\u8BF7\u6C42\uFF0C\u8BF7\u67E5\u770B\u7528\u91CF\u6216\u7A0D\u540E\u91CD\u8BD5\u3002", "ChatGPT is limiting requests. Check your usage or try again shortly.");
    if (response.status >= 500) throw new AuthError("network", "ChatGPT \u767B\u5F55\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "The ChatGPT sign-in service is temporarily unavailable. Please try again shortly.");
    throw new AuthError("error", "ChatGPT \u672A\u63A5\u53D7\u672C\u6B21\u6388\u6743\u3002\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "ChatGPT did not accept this authorization. Please sign in again.");
  }
  async revoke(clientId, refreshToken) {
    try {
      const provider = await this.discovery();
      if (!provider.revocation) return false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.fetch(provider.revocation, {
            method: "POST",
            body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: clientId })
          });
          await response.body?.cancel().catch(() => void 0);
          if (response.status === 200) return true;
          if (response.status < 500) return false;
        } catch {
        }
        if (attempt === 0) await (0, import_promises.setTimeout)(400);
      }
    } catch {
    }
    return false;
  }
};
function parseTokenSet(data, idToken, previous) {
  const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : data.scope === void 0 ? previous?.scopes : void 0;
  if (!scopes || !previous && !scopes.includes("openid")) throw invalidTokens();
  if (!nonempty(data.access_token)) {
    if (previous || hasPlan(scopes) || scopes.includes("offline_access")) throw invalidTokens();
    return { idToken, scopes };
  }
  const expiresAt = typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1e3 : 0;
  const earliest = data.earliest_refresh_at;
  const refreshAfter = typeof earliest === "number" ? earliest * 1e3 : typeof earliest === "string" ? Date.parse(earliest) : NaN;
  if (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || (previous || scopes.includes("offline_access")) && !nonempty(data.refresh_token)) throw invalidTokens();
  return {
    scopes,
    idToken,
    accessToken: data.access_token,
    expiresAt,
    ...Number.isFinite(refreshAfter) && { refreshAfter },
    ...nonempty(data.refresh_token) && { refreshToken: data.refresh_token }
  };
}

// electron/auth/siwcClient.ts
var storageError = () => new AuthError("error", "\u65E0\u6CD5\u8BFB\u53D6\u6216\u5199\u5165 Windows \u52A0\u5BC6\u51ED\u636E\u3002\u8BF7\u68C0\u67E5\u672C\u5730\u6570\u636E\u8BBE\u7F6E\u3002", "Could not read or save your encrypted Windows credentials. Check your local data settings.");
var signedOut = () => new AuthError("signed-out", "\u8BF7\u5148\u4F7F\u7528 ChatGPT \u767B\u5F55\u3002", "Please sign in with ChatGPT first.");
var noPlan = () => new AuthError("identity-only", "\u8D26\u53F7\u5DF2\u8FDE\u63A5\uFF0C\u4F46\u5C1A\u672A\u6388\u4E88 ChatGPT \u5957\u9910\u4F7F\u7528\u6743\u9650\u3002", "Your account is connected. Authorize ChatGPT plan usage to start chatting.");
var expired = () => new AuthError("expired", "ChatGPT \u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "Your ChatGPT session has expired. Please sign in again.");
var mismatched = () => new AuthError("error", "ChatGPT \u8FD4\u56DE\u4E86\u4E0D\u540C\u7684\u8D26\u53F7\u3002\u8BF7\u9009\u62E9\u539F\u8D26\u53F7\uFF0C\u6216\u6DFB\u52A0\u72EC\u7ACB\u8D26\u53F7\u3002", "ChatGPT returned a different account. Select the original account or add a separate one.");
var freshVault = () => ({ version: 1, hostId: "urn:uuid:" + (0, import_node_crypto2.randomUUID)(), profiles: [] });
function summarize(profile) {
  return { id: profile.clientId, email: profile.identity.email, name: profile.identity.name };
}
function validateVault(value) {
  const vault = asObject(value);
  if (vault.version !== 1 || !nonempty(vault.hostId) || !/^urn:uuid:[a-f0-9-]{36}$/.test(vault.hostId) || !Array.isArray(vault.profiles)) {
    throw storageError();
  }
  for (const value2 of vault.profiles) {
    const profile = asObject(value2);
    if (!validClientId(profile.clientId) || !nonempty(asObject(profile.identity).subject)) throw storageError();
    if (profile.session && !validSession(profile.session)) throw storageError();
    if (profile.pendingRotation) {
      const rotation = asObject(profile.pendingRotation);
      if (!validSession(rotation.session) || typeof rotation.receivedAt !== "number") throw storageError();
    }
  }
  if (vault.activeId !== void 0 && !validClientId(vault.activeId) || vault.pendingClientId !== void 0 && !validClientId(vault.pendingClientId)) throw storageError();
  return vault;
}
function validSession(value) {
  const session2 = asObject(value);
  return nonempty(session2.idToken) && Array.isArray(session2.scopes) && session2.scopes.every(nonempty) && (session2.accessToken === void 0 || nonempty(session2.accessToken) && typeof session2.expiresAt === "number") && (session2.refreshAfter === void 0 || typeof session2.refreshAfter === "number") && (session2.refreshToken === void 0 || nonempty(session2.refreshToken));
}
function asAuthError(error) {
  return error instanceof AuthError ? error : new AuthError("error", "\u65E0\u6CD5\u5B8C\u6210 ChatGPT \u8FDE\u63A5\uFF0C\u8BF7\u91CD\u8BD5\u3002", "Could not connect your ChatGPT account. Please try again.");
}
var AuthService = class {
  userData;
  openBrowser;
  storage;
  locale;
  path;
  protocol;
  vault = freshVault();
  loadFailure = false;
  operation = Promise.resolve();
  signingIn;
  refreshing;
  stopping = 0;
  constructor(userData, openBrowser, storage, fetcher = globalThis.fetch, locale = () => "zh-CN") {
    this.userData = userData;
    this.openBrowser = openBrowser;
    this.storage = storage;
    this.locale = locale;
    this.path = (0, import_node_path.join)(userData, "chatgpt-auth.v1.enc");
    this.protocol = new SiwcProtocol(fetcher);
    try {
      const file = (0, import_node_fs.readFileSync)(this.path);
      if (!storage.isEncryptionAvailable()) throw storageError();
      this.vault = validateVault(JSON.parse(storage.decryptString(file)));
    } catch (error) {
      if (error.code !== "ENOENT") this.loadFailure = true;
    }
  }
  commit(vault) {
    if (this.loadFailure || !this.storage.isEncryptionAvailable()) throw storageError();
    const temp = this.path + "." + (0, import_node_crypto2.randomUUID)() + ".tmp";
    try {
      (0, import_node_fs.mkdirSync)(this.userData, { recursive: true });
      (0, import_node_fs.writeFileSync)(temp, this.storage.encryptString(JSON.stringify(vault)), { mode: 384, flag: "wx", flush: true });
      (0, import_node_fs.renameSync)(temp, this.path);
      this.vault = vault;
    } catch {
      try {
        (0, import_node_fs.rmSync)(temp, { force: true });
      } catch {
      }
      throw storageError();
    }
  }
  active() {
    return this.vault.profiles.find((profile) => profile.clientId === this.vault.activeId);
  }
  withProfile(profile) {
    const profiles = this.vault.profiles;
    return {
      ...this.vault,
      profiles: profiles.some((item) => item.clientId === profile.clientId) ? profiles.map((item) => item.clientId === profile.clientId ? profile : item) : [...profiles, profile]
    };
  }
  exclusive(run) {
    const result = this.operation.then(run);
    this.operation = result.then(() => void 0, () => void 0);
    return result;
  }
  status() {
    if (this.loadFailure) return { state: "error", message: storageError().localized(this.locale()) };
    const account = this.active();
    const accounts = this.vault.profiles.map(summarize);
    const common = { accounts, ...account && { account: summarize(account) } };
    if (this.stopping) return { state: "signed-out", ...common };
    if (account?.expired) return { state: "expired", ...common, message: expired().localized(this.locale()) };
    if (!account?.session) return { state: "signed-out", ...common };
    if (!hasPlan(account.session.scopes)) return { state: "identity-only", ...common, message: noPlan().localized(this.locale()) };
    if (account.session.refreshToken || (account.session.expiresAt ?? 0) > Date.now()) {
      return { state: "connected", ...common };
    }
    return { state: "expired", ...common, message: expired().localized(this.locale()) };
  }
  failed(error) {
    const failure = asAuthError(error);
    const current = this.status();
    return {
      ...current,
      // An abandoned account switch must leave a working connection usable.
      state: current.state === "connected" || current.state === "identity-only" ? current.state : failure.code,
      message: failure.localized(this.locale())
    };
  }
  signIn(options = {}) {
    if (this.signingIn) return this.signingIn.result;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(3 * 6e4)]);
    const result = this.exclusive(async () => {
      if (signal.aborted) throw denied();
      if (this.loadFailure) throw storageError();
      const selected = options.accountId ? this.vault.profiles.find((profile) => profile.clientId === options.accountId) : options.addAccount ? void 0 : this.active();
      if (options.accountId && !selected) throw new AuthError("error", "\u627E\u4E0D\u5230\u6240\u9009\u7684 ChatGPT \u8D26\u53F7\u3002", "Could not find the selected ChatGPT account.");
      const previous = selected ? { clientId: selected.clientId, email: selected.identity.email } : this.vault.pendingClientId ? { clientId: this.vault.pendingClientId } : void 0;
      this.commit(this.vault);
      const { clientId, identity, tokens } = await this.protocol.authorize(
        this.vault.hostId,
        previous,
        options.reconsent === true,
        this.openBrowser,
        (issued) => {
          if (!selected && !this.vault.profiles.some((profile) => profile.clientId === issued)) {
            this.commit({ ...this.vault, pendingClientId: issued });
          }
        },
        signal,
        this.locale()
      );
      const existing = this.vault.profiles.find((profile) => profile.clientId === clientId);
      if (existing && existing.identity.subject !== identity.subject) throw mismatched();
      const vault = this.withProfile({ clientId, identity, session: tokens });
      this.commit({
        ...vault,
        activeId: clientId,
        pendingClientId: vault.pendingClientId === clientId ? void 0 : vault.pendingClientId
      });
      return this.status();
    }).catch((error) => this.failed(error)).finally(() => {
      this.signingIn = void 0;
    });
    this.signingIn = { abort, result };
    return result;
  }
  cancel() {
    this.signingIn?.abort.abort();
  }
  async accessToken(forceRefresh = false) {
    if (this.loadFailure) throw storageError();
    if (this.stopping) throw signedOut();
    const profile = this.active();
    if (profile?.expired) throw expired();
    if (!profile?.session) throw signedOut();
    if (!hasPlan(profile.session.scopes)) throw noPlan();
    if (this.refreshing?.accountId === profile.clientId) return this.refreshing.result;
    if (!profile.pendingRotation) {
      const session2 = profile.session;
      const now = Date.now();
      const remaining = (session2.expiresAt ?? 0) - now;
      const allowed = (session2.refreshAfter ?? 0) <= now;
      if (!forceRefresh && session2.accessToken && remaining > 0 && (remaining > 3e4 || !session2.refreshToken || !allowed)) {
        return session2.accessToken;
      }
      if (!allowed) throw new AuthError("network", "ChatGPT \u6682\u65F6\u65E0\u6CD5\u7EED\u671F\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "Your ChatGPT session cannot be renewed yet. Try again shortly.");
    }
    const result = this.exclusive(async () => {
      if (this.stopping) throw signedOut();
      const selected = this.active();
      if (selected?.clientId !== profile.clientId) throw signedOut();
      return this.renew(selected);
    }).finally(() => {
      if (this.refreshing?.result === result) this.refreshing = void 0;
    });
    this.refreshing = { accountId: profile.clientId, result };
    return result;
  }
  async renew(profile) {
    const previous = profile.session;
    if (!previous) throw expired();
    if (!hasPlan(previous.scopes)) throw noPlan();
    let rotation = profile.pendingRotation;
    try {
      if (!rotation) {
        const session2 = await this.protocol.refresh(profile.clientId, previous);
        if (session2.idToken !== previous.idToken) {
          rotation = { session: session2, receivedAt: Date.now() };
          this.persistRotated(this.withProfile({ ...profile, pendingRotation: rotation }));
        } else {
          this.persistRotated(this.withProfile({ ...profile, session: session2 }));
          if (!hasPlan(session2.scopes)) throw noPlan();
          return session2.accessToken;
        }
      }
      let identity;
      try {
        identity = await this.protocol.identity(rotation.session.idToken, profile.clientId, { receivedAt: rotation.receivedAt });
        if (identity.subject !== profile.identity.subject) throw mismatched();
      } catch (error) {
        const failure = asAuthError(error);
        if (failure.code === "error") throw new AuthError("expired", "\u65E0\u6CD5\u9A8C\u8BC1 ChatGPT \u7EED\u671F\u8EAB\u4EFD\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002", "Could not verify your ChatGPT identity during renewal. Please sign in again.");
        throw failure;
      }
      this.commit(this.withProfile({ clientId: profile.clientId, identity, session: rotation.session }));
      if (!hasPlan(rotation.session.scopes)) throw noPlan();
      if ((rotation.session.expiresAt ?? 0) <= Date.now()) {
        throw new AuthError("network", "ChatGPT \u51ED\u636E\u5DF2\u6062\u590D\uFF0C\u8BF7\u91CD\u8BD5\u4EE5\u7EED\u671F\u3002", "Your ChatGPT credentials were recovered. Retry to renew your session.");
      }
      return rotation.session.accessToken;
    } catch (error) {
      const failure = asAuthError(error);
      if (failure.code === "expired") {
        this.commit(this.withProfile({ clientId: profile.clientId, identity: profile.identity, expired: true }));
      }
      throw failure;
    }
  }
  persistRotated(vault) {
    try {
      this.commit(vault);
    } catch (error) {
      this.vault = vault;
      throw error;
    }
  }
  async revoke(profile) {
    const token = profile.pendingRotation?.session.refreshToken ?? profile.session?.refreshToken;
    if (token) return this.protocol.revoke(profile.clientId, token);
    return !profile.session?.accessToken;
  }
  async signOut() {
    this.cancel();
    this.stopping++;
    let confirmed;
    try {
      confirmed = await this.exclusive(async () => {
        const profile = this.active();
        if (!profile) return true;
        const revoked = await this.revoke(profile);
        this.commit(this.withProfile({ clientId: profile.clientId, identity: profile.identity }));
        return revoked;
      });
    } catch (error) {
      return { ...this.status(), state: "error", message: asAuthError(error).localized(this.locale()) };
    } finally {
      this.stopping--;
    }
    return {
      ...this.status(),
      ...!confirmed && { message: translate(
        this.locale(),
        "\u5DF2\u5728\u672C\u673A\u6CE8\u9500\u3002\u672A\u80FD\u786E\u8BA4\u8FDC\u7A0B\u64A4\u9500\uFF0C\u53EF\u5728 ChatGPT \u8BBE\u7F6E\u4E2D\u65AD\u5F00 Dr. Meow\u3002",
        "You are signed out on this device. You can disconnect Dr. Meow in ChatGPT settings to confirm that access has been revoked."
      ) }
    };
  }
  async reset() {
    this.cancel();
    this.stopping++;
    let confirmed;
    try {
      confirmed = await this.exclusive(async () => {
        const revoked = !this.loadFailure && (await Promise.all(this.vault.profiles.map((profile) => this.revoke(profile)))).every(Boolean);
        (0, import_node_fs.rmSync)(this.path, { force: true });
        this.vault = freshVault();
        this.loadFailure = false;
        return revoked;
      });
    } catch {
      throw storageError();
    } finally {
      this.stopping--;
    }
    return {
      ...this.status(),
      ...!confirmed && { message: translate(
        this.locale(),
        "\u5DF2\u5220\u9664\u672C\u673A\u51ED\u636E\u3002\u672A\u80FD\u786E\u8BA4\u8FDC\u7A0B\u64A4\u9500\uFF0C\u53EF\u5728 ChatGPT \u8BBE\u7F6E\u4E2D\u65AD\u5F00 Dr. Meow\u3002",
        "Local credentials were deleted. You can disconnect Dr. Meow in ChatGPT settings to confirm that access has been revoked."
      ) }
    };
  }
};

// shared/contracts.ts
var skinIds = ["original", "ragdoll", "british", "calico"];
var chatgptUsageUrl = "https://chatgpt.com/settings/usage?tab=overview";

// shared/petCare.ts
var hour = 36e5;
var careTuning = {
  neutralMood: 56,
  fullnessPerHour: 5,
  moodPerHour: 1,
  maxOfflineHours: 8,
  stateInterval: 3e4,
  affectionInterval: 5 * 6e4,
  minimumRest: 2 * 6e4,
  feeding: {
    fish: { fullness: 8, mood: 2, affection: 0.5 },
    can: { fullness: 14, mood: 3, affection: 1 },
    treat: { fullness: 5, mood: 4, affection: 0.75 }
  },
  gains: {
    pet: { mood: 6, affection: 1 },
    play: { mood: 10, affection: 1 },
    rest: { mood: 8, affection: 0.5 }
  }
};
var careContacts = {
  petting: { duration: 1300, progress: 460 / 1300 },
  eating: { duration: 1550, progress: 0.44 },
  yarn: { duration: 5e3, progress: 0.38 },
  sleeping: { duration: 1150, progress: 0.9 },
  waking: { duration: 1050, progress: 0.8 }
};
function moodFor(pet, previous) {
  if (previous === "happy" ? pet.mood >= 70 : pet.mood >= 75) return "happy";
  if (previous === "curious" ? pet.fullness <= 44 || pet.mood <= 49 : pet.fullness <= 39 || pet.mood <= 45) return "curious";
  if (previous === "content" ? pet.mood >= 59 : pet.mood >= 64) return "content";
  return "calm";
}

// electron/database.ts
var import_node_crypto3 = require("node:crypto");
var import_node_sqlite = require("node:sqlite");
init_geometry();
var defaultSettings = {
  locale: "zh-CN",
  petName: "Dr. Meow",
  skin: "original",
  size: 180,
  alwaysOnTop: true,
  positionLocked: false,
  avoidFullscreen: true,
  startOnLogin: false,
  opacity: 1,
  animation: "full",
  quiet: false,
  tone: "normal",
  length: "standard",
  model: ""
};
var clamp2 = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
var newPet = () => ({
  fullness: 78,
  mood: careTuning.neutralMood,
  affection: 10,
  lastInteractionAt: Date.now()
});
function petAtTime(state, now = Date.now()) {
  const hours = Math.min(careTuning.maxOfflineHours, Math.max(0, (now - state.lastInteractionAt) / hour));
  const target = careTuning.neutralMood;
  const mood = state.mood ?? careTuning.neutralMood;
  const pace = careTuning.moodPerHour;
  return {
    ...state,
    fullness: clamp2(state.fullness - hours * careTuning.fullnessPerHour),
    mood: mood <= 0 ? 0 : clamp2(mood + Math.sign(target - mood) * Math.min(Math.abs(target - mood), hours * pace)),
    affection: clamp2(state.affection)
  };
}
function updateClock(state, now) {
  return { ...petAtTime(state, now), lastInteractionAt: Math.max(state.lastInteractionAt, now) };
}
function caredFor(state) {
  return { ...state, turnsSinceCare: 0, careHintAt: void 0 };
}
function applyPetAction(state, action, now = Date.now()) {
  const next = updateClock(state, now);
  if (action.type === "sleep") return { ...next, restingSince: next.restingSince ?? now };
  if (action.type === "wake") {
    delete next.restingSince;
    if (state.restingSince === void 0 || now - state.restingSince < careTuning.minimumRest) return next;
  }
  const kind = action.type === "wake" ? "rest" : action.type;
  const gain = action.type === "feed" ? careTuning.feeding[action.food] : careTuning.gains[action.type === "wake" ? "rest" : action.type];
  const before = { ...next };
  const lastState = state.lastRewards?.[kind];
  const lastAffection = state.lastAffectionRewards?.[kind];
  if (lastState === void 0 || now - lastState >= careTuning.stateInterval) {
    if (action.type === "feed") next.fullness = clamp2(next.fullness + careTuning.feeding[action.food].fullness);
    next.mood = clamp2(next.mood + gain.mood);
    if (next.fullness !== before.fullness || next.mood !== before.mood) {
      next.lastRewards = { ...state.lastRewards, [kind]: now };
    }
  }
  if (lastAffection === void 0 || now - lastAffection >= careTuning.affectionInterval) {
    next.affection = clamp2(next.affection + gain.affection);
    if (next.affection !== before.affection) next.lastAffectionRewards = { ...state.lastAffectionRewards, [kind]: now };
  }
  return next.fullness > before.fullness || next.mood > before.mood || next.affection > before.affection ? caredFor(next) : next;
}
function sanitizeSettings(patch, current) {
  const next = { ...current };
  if (patch.locale === "zh-CN" || patch.locale === "en") next.locale = patch.locale;
  if (typeof patch.petName === "string") next.petName = normalizePetName(patch.petName) || "Dr. Meow";
  if (patch.skin && skinIds.includes(patch.skin)) next.skin = patch.skin;
  if (typeof patch.size === "number" && Number.isFinite(patch.size)) next.size = Math.round(clamp2(patch.size, 180, 360));
  if (typeof patch.opacity === "number" && Number.isFinite(patch.opacity)) next.opacity = clamp2(patch.opacity, 0.35, 1);
  for (const key of ["alwaysOnTop", "positionLocked", "avoidFullscreen", "startOnLogin", "quiet"]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if (patch.animation === "full" || patch.animation === "gentle") next.animation = patch.animation;
  if (patch.tone === "normal" || patch.tone === "cute" || patch.tone === "professional") next.tone = patch.tone;
  if (patch.length === "short" || patch.length === "standard" || patch.length === "detailed") next.length = patch.length;
  if (typeof patch.model === "string" && patch.model.length <= 180) next.model = patch.model;
  return next;
}
var LocalDatabase = class {
  db;
  constructor(path) {
    this.db = new import_node_sqlite.DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS local_values (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
      CREATE TABLE IF NOT EXISTS bonded_turns (
        user_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
    this.migrate();
    for (const row of this.db.prepare("SELECT id, content FROM messages WHERE json_extract(content, '$.status')='streaming'").all()) {
      const message = JSON.parse(String(row.content));
      this.db.prepare("UPDATE messages SET content=? WHERE id=?").run(JSON.stringify({ ...message, status: "cancelled" }), String(row.id));
    }
  }
  migrate() {
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
    if (version >= 4) return;
    this.db.exec("BEGIN");
    try {
      const position = this.position();
      if (version === 0 && position) {
        const { size } = this.settings();
        const heightAdded = petViewport(size).height - Math.max(size, 280);
        this.savePosition({ x: position.x, y: position.y - heightAdded });
      }
      this.db.exec("ALTER TABLE bonded_turns ADD COLUMN effect TEXT");
      const pet = this.read("pet", null);
      if (pet) {
        const { hunger, ...saved } = pet;
        this.savePet({
          ...saved,
          fullness: Number.isFinite(hunger) ? clamp2(100 - hunger) : saved.fullness,
          mood: saved.mood ?? careTuning.neutralMood,
          lastInteractionAt: Date.now(),
          lastAffectionRewards: saved.lastAffectionRewards ?? saved.lastRewards,
          turnsSinceCare: saved.turnsSinceCare ?? 0
        });
      }
      this.db.exec("PRAGMA user_version=4; COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  read(key, fallback) {
    const row = this.db.prepare("SELECT value FROM local_values WHERE key=?").get(key);
    return row ? JSON.parse(String(row.value)) : fallback;
  }
  write(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO local_values(key,value) VALUES (?,?)").run(key, JSON.stringify(value));
  }
  settings() {
    return sanitizeSettings(this.read("settings", {}), defaultSettings);
  }
  saveSettings(value) {
    this.write("settings", value);
  }
  pet() {
    const saved = this.read("pet", null);
    if (saved) return saved;
    const pet = newPet();
    this.savePet(pet);
    return pet;
  }
  savePet(pet) {
    this.write("pet", pet);
  }
  currentPet(now = Date.now()) {
    const next = updateClock(this.pet(), now);
    this.savePet(next);
    return next;
  }
  recoverPet(now = Date.now()) {
    const next = updateClock(this.pet(), now);
    if (careReason(next)) {
      for (const key of ["fullness", "mood", "affection"]) {
        next[key] = Math.max(next[key], chatCareTuning.recovery[key]);
      }
      delete next.restingSince;
      Object.assign(next, caredFor(next));
    }
    this.savePet(next);
    return next;
  }
  resetPet() {
    this.savePet(newPet());
  }
  endPetRest(now = Date.now()) {
    const pet = this.pet();
    if (pet.restingSince === void 0) return void 0;
    const next = updateClock(pet, now);
    delete next.restingSince;
    this.savePet(next);
    return next;
  }
  position() {
    return this.read("position", null);
  }
  savePosition(point) {
    this.write("position", point);
  }
  assemble(row) {
    const messages2 = this.db.prepare("SELECT content FROM messages WHERE conversation_id=? ORDER BY rowid").all(row.id);
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      messages: messages2.map((message) => JSON.parse(message.content))
    };
  }
  chats() {
    const rows = this.db.prepare("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC, rowid DESC").all();
    return rows.map((row) => this.assemble(row));
  }
  chat(id) {
    const row = this.db.prepare("SELECT id, title, updated_at FROM conversations WHERE id=?").get(id);
    return row && this.assemble(row);
  }
  createChat() {
    const chat = { id: (0, import_node_crypto3.randomUUID)(), title: translate(this.settings().locale, "\u65B0\u5BF9\u8BDD", "New chat"), updatedAt: Date.now(), messages: [] };
    this.db.prepare("INSERT INTO conversations VALUES (?,?,?)").run(chat.id, chat.title, chat.updatedAt);
    return chat;
  }
  rename(id, title) {
    this.db.prepare("UPDATE conversations SET title=? WHERE id=?").run(title, id);
  }
  remove(id) {
    this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
  }
  clearChats() {
    this.db.exec("DELETE FROM conversations; PRAGMA wal_checkpoint(TRUNCATE);");
  }
  clearAll() {
    this.db.exec("BEGIN; DELETE FROM conversations; DELETE FROM local_values; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);");
  }
  startTurn(id, user, assistant, retryId) {
    this.db.exec("BEGIN");
    try {
      if (retryId) this.db.prepare("DELETE FROM messages WHERE conversation_id=? AND id=?").run(id, retryId);
      const insert = this.db.prepare("INSERT INTO messages VALUES (?,?,?)");
      if (!retryId) insert.run(user.id, id, JSON.stringify(user));
      insert.run(assistant.id, id, JSON.stringify(assistant));
      this.db.prepare("UPDATE conversations SET updated_at=?, title=CASE WHEN title IN ('\u65B0\u5BF9\u8BDD','New chat') THEN ? ELSE title END WHERE id=?").run(Date.now(), [...user.text.replace(/\s+/g, " ")].slice(0, 38).join(""), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  updateMessage(message) {
    this.db.prepare("UPDATE messages SET content=? WHERE id=?").run(JSON.stringify(message), message.id);
  }
  completeChatReply(userMessageId, reply, now = Date.now(), name = this.settings().petName) {
    this.db.exec("BEGIN");
    try {
      const settled = this.db.prepare("SELECT effect FROM bonded_turns WHERE user_message_id=?").get(userMessageId);
      reply.completedAt = now;
      if (settled) {
        if (settled.effect) reply.petEffect = JSON.parse(String(settled.effect));
        this.updateMessage(reply);
        this.db.exec("COMMIT");
        return void 0;
      }
      const row = this.db.prepare("SELECT content FROM messages WHERE id=? AND json_extract(content,'$.role')='user'").get(userMessageId);
      if (!row) throw new Error("Missing user message for pet settlement");
      const user = JSON.parse(String(row.content));
      const next = updateClock(this.pet(), now);
      const effect = chatPetEffect(user.text, reply.text, name);
      const elapsed = next.lastReplyAt === void 0 ? Infinity : user.createdAt - next.lastReplyAt;
      const sinceReward = next.lastTimelyRewardAt === void 0 ? Infinity : user.createdAt - next.lastTimelyRewardAt;
      if (elapsed >= 0 && elapsed <= chatCareTuning.timelyWindow && sinceReward >= chatCareTuning.timelyInterval) {
        effect.mood = (effect.mood ?? 0) + chatCareTuning.timelyMood;
        effect.timely = true;
        next.lastTimelyRewardAt = user.createdAt;
      }
      for (const key of ["fullness", "mood", "affection"]) {
        const before = next[key];
        next[key] = clamp2(before + (effect[key] ?? 0));
        effect[key] = Math.round((next[key] - before) * 100) / 100;
      }
      next.lastReplyAt = now;
      next.turnsSinceCare = (next.turnsSinceCare ?? 0) + 1;
      if (next.turnsSinceCare >= chatCareTuning.hintTurns && now - (next.lastCareHintAt ?? -Infinity) >= chatCareTuning.hintInterval) {
        next.lastCareHintAt = next.careHintAt = now;
      }
      reply.petEffect = effect;
      this.updateMessage(reply);
      this.db.prepare("INSERT INTO bonded_turns(user_message_id,effect) VALUES (?,?)").run(userMessageId, JSON.stringify(effect));
      this.savePet(next);
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
};

// electron/windows.ts
var import_electron = require("electron");
var import_node_path3 = require("node:path");
var import_node_url = require("node:url");
init_geometry();
init_fullscreenMonitor();
var rendererFile = (0, import_node_path3.join)(__dirname, "../renderer/index.html");
var dev = !import_electron.app.isPackaged && process.env.DR_MEOW_DEV === "1";
var rendererBase = dev ? "http://127.0.0.1:4177/" : (0, import_node_url.pathToFileURL)(rendererFile).href;
var DesktopWindows = class {
  constructor(db, isQuitting, monitorFullscreen = true) {
    this.db = db;
    this.isQuitting = isQuitting;
    this.monitorFullscreen = monitorFullscreen;
  }
  db;
  isQuitting;
  monitorFullscreen;
  windows = {};
  tray;
  timer;
  cursor = null;
  hasPointer = false;
  interactive = false;
  pointerHeld = false;
  positionLocked = false;
  drag;
  chatSearch = false;
  petReady = false;
  petWanted = true;
  avoidFullscreen = true;
  fullscreenObstruction = false;
  stopFullscreenMonitor;
  owns(event, kinds) {
    return kinds.some((kind) => {
      const win = this.windows[kind];
      return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame?.url === this.url(kind);
    });
  }
  url(kind) {
    return rendererBase + "#" + kind;
  }
  make(kind, options) {
    const win = new import_electron.BrowserWindow({
      ...options,
      show: false,
      frame: false,
      autoHideMenuBar: true,
      icon: (0, import_node_path3.join)(__dirname, "../renderer/assets/app.ico"),
      webPreferences: {
        preload: (0, import_node_path3.join)(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        devTools: dev
      }
    });
    this.windows[kind] = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-redirect", (event) => event.preventDefault());
    void win.loadURL(this.url(kind)).catch(() => {
      if (!win.isDestroyed()) win.destroy();
    });
    win.once("closed", () => {
      delete this.windows[kind];
    });
    return win;
  }
  start() {
    const settings = this.db.settings();
    this.avoidFullscreen = settings.avoidFullscreen;
    this.positionLocked = settings.positionLocked;
    const size = petViewport(settings.size);
    const previous = this.db.position();
    const area = previous ? import_electron.screen.getDisplayNearestPoint(previous).workArea : import_electron.screen.getPrimaryDisplay().workArea;
    const position = previous ?? {
      x: area.x + area.width - size.width - 22,
      y: area.y + area.height - size.height - 12
    };
    const pet = this.make("pet", {
      ...size,
      ...keepVisible({ ...size, ...position }, area),
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: settings.alwaysOnTop
    });
    pet.setIgnoreMouseEvents(true, { forward: true });
    pet.once("ready-to-show", () => {
      this.petReady = true;
      this.syncPetVisibility();
    });
    pet.on("show", () => {
      this.refreshTray();
      this.trackPointer();
    });
    pet.on("hide", () => {
      pet.setFocusable(false);
      this.pointerHeld = false;
      this.finishDrag();
      if (this.timer) clearInterval(this.timer);
      this.timer = void 0;
      this.hasPointer = false;
      this.cursor = null;
      this.setPetHit(false);
      this.emit("pet", "pet:pointer", null);
      this.refreshTray();
    });
    pet.on("close", (event) => {
      if (this.isQuitting()) return;
      event.preventDefault();
      this.petWanted = false;
      this.syncPetVisibility();
    });
    this.syncFullscreenMonitor();
    const icon = import_electron.nativeImage.createFromPath((0, import_node_path3.join)(__dirname, "../renderer/assets/tray.png"));
    this.tray = new import_electron.Tray(icon.isEmpty() ? import_electron.nativeImage.createFromPath(process.execPath) : icon);
    this.tray.on("double-click", () => this.togglePet());
    this.refreshTray();
    import_electron.screen.on("display-added", () => this.reconcileDisplays());
    import_electron.screen.on("display-removed", () => this.reconcileDisplays());
    import_electron.screen.on("display-metrics-changed", () => this.reconcileDisplays());
  }
  trackPointer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollPointer(), 45);
    this.pollPointer();
  }
  pollPointer() {
    const win = this.windows.pet;
    if (!win?.isVisible()) return;
    const cursor = import_electron.screen.getCursorScreenPoint();
    if (this.drag) this.moveDrag(cursor);
    const { x, y, width, height } = win.getBounds();
    const local = { x: cursor.x - x, y: cursor.y - y };
    const inside = local.x >= 0 && local.y >= 0 && local.x < width && local.y < height;
    if (!inside && !this.drag && !this.pointerHeld) this.setPetHit(false);
    if (inside && (!this.hasPointer || local.x !== this.cursor?.x || local.y !== this.cursor?.y)) {
      this.emit("pet", "pet:pointer", local);
    } else if (!inside && this.hasPointer) {
      this.emit("pet", "pet:pointer", null);
    }
    this.hasPointer = inside;
    this.cursor = inside ? local : null;
  }
  setPetHit(active) {
    const pet = this.windows.pet;
    if (!pet || pet.isDestroyed()) return;
    const next = pet.isVisible() && Boolean(this.drag || this.pointerHeld || active);
    if (this.interactive === next) return;
    this.interactive = next;
    pet.setIgnoreMouseEvents(!next, { forward: true });
  }
  setPetPress(pressed) {
    this.pointerHeld = pressed && this.windows.pet?.isVisible() === true;
    if (this.pointerHeld) this.setPetHit(true);
    else this.pollPointer();
  }
  petDrag(phase) {
    const pet = this.windows.pet;
    if (!pet?.isVisible() || this.positionLocked) return;
    if (phase === "start" && !this.drag) {
      const [x, y] = pet.getPosition();
      this.drag = { cursor: import_electron.screen.getCursorScreenPoint(), window: { x, y } };
      this.setPetHit(true);
    } else if (phase === "move" && this.drag) {
      this.moveDrag(import_electron.screen.getCursorScreenPoint());
    } else if (phase === "end") {
      this.finishDrag();
    }
  }
  moveDrag(cursor) {
    const pet = this.windows.pet;
    if (!pet || !this.drag) return;
    const position = {
      x: this.drag.window.x + cursor.x - this.drag.cursor.x,
      y: this.drag.window.y + cursor.y - this.drag.cursor.y
    };
    const bounds = pet.getBounds();
    const area = import_electron.screen.getDisplayNearestPoint(cursor).workArea;
    const point = keepVisible({ ...bounds, ...position }, area);
    if (bounds.x !== point.x || bounds.y !== point.y) pet.setPosition(point.x, point.y);
  }
  finishDrag() {
    if (!this.drag) return;
    this.moveDrag(import_electron.screen.getCursorScreenPoint());
    this.drag = void 0;
    const [x, y] = this.windows.pet?.getPosition() ?? [0, 0];
    this.db.savePosition({ x, y });
    this.pollPointer();
  }
  togglePet() {
    this.petWanted = !this.petWanted;
    this.syncPetVisibility();
  }
  syncPetVisibility() {
    const pet = this.windows.pet;
    if (!pet || pet.isDestroyed() || !this.petReady || this.isQuitting()) return;
    const visible = this.petWanted && !(this.avoidFullscreen && this.fullscreenObstruction);
    if (visible && !pet.isVisible()) pet.showInactive();
    else if (!visible && pet.isVisible()) pet.hide();
    else this.refreshTray();
  }
  setFullscreenObstruction(covered) {
    if (this.fullscreenObstruction === covered) return;
    this.fullscreenObstruction = covered;
    this.syncPetVisibility();
  }
  syncFullscreenMonitor() {
    const pet = this.windows.pet;
    if (!this.avoidFullscreen) {
      this.stopFullscreenMonitor?.();
      this.stopFullscreenMonitor = void 0;
      this.setFullscreenObstruction(false);
    } else if (this.monitorFullscreen && process.platform === "win32" && pet && !this.stopFullscreenMonitor) {
      const path = fullscreenProbePath(import_electron.app.isPackaged ? process.resourcesPath : void 0);
      const handle = pet.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
      this.stopFullscreenMonitor = watchFullscreen(path, hwnd, (covered) => this.setFullscreenObstruction(covered));
    }
  }
  refreshTray() {
    const t = translator(this.db.settings().locale);
    this.tray?.setToolTip(t("Dr. Meow \xB7 \u732B\u535A\u58EB", "Dr. Meow"));
    this.tray?.setContextMenu(import_electron.Menu.buildFromTemplate([
      { label: this.petWanted ? t("\u9690\u85CF\u732B\u535A\u58EB", "Hide Dr. Meow") : t("\u663E\u793A\u732B\u535A\u58EB", "Show Dr. Meow"), click: () => this.togglePet() },
      ...this.petWanted && this.avoidFullscreen && this.fullscreenObstruction ? [{
        label: t("\u5168\u5C4F\u671F\u95F4\u6682\u65F6\u9690\u85CF", "Temporarily hidden during fullscreen"),
        enabled: false
      }] : [],
      { label: t("\u6253\u5F00\u804A\u5929", "Open chat"), click: () => this.openChat() },
      { label: t("\u8BBE\u7F6E", "Settings"), click: () => this.openSettings() },
      { type: "separator" },
      { label: t("\u9000\u51FA Dr. Meow", "Quit Dr. Meow"), click: () => import_electron.app.quit() }
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
      const pet2 = this.windows.pet?.getBounds();
      if (pet2 && !existing.isVisible()) {
        const area2 = import_electron.screen.getDisplayMatching(pet2).workArea;
        const point = besidePet(pet2, existing.getBounds(), area2);
        existing.setPosition(point.x, point.y);
      }
      if (existing.isMinimized()) existing.restore();
      existing.show();
      this.emit("chat", "chat:search", search);
      this.animate("greet");
      return existing;
    }
    const pet = this.windows.pet?.getBounds();
    const area = pet ? import_electron.screen.getDisplayMatching(pet).workArea : import_electron.screen.getPrimaryDisplay().workArea;
    const panel = { x: area.x, y: area.y, width: 396, height: 516 };
    const chat = this.make("chat", {
      ...panel,
      ...pet ? besidePet(pet, panel, area) : keepVisible(panel, area),
      minWidth: 320,
      minHeight: 300,
      backgroundColor: "#fff9f5",
      maximizable: false
    });
    chat.once("ready-to-show", () => {
      this.emit("chat", "chat:search", this.chatSearch);
      chat.show();
    });
    const publishVisibility = () => this.emit("pet", "chat:visibility", this.chatVisible());
    chat.on("show", publishVisibility);
    chat.on("hide", publishVisibility);
    chat.on("minimize", publishVisibility);
    chat.on("restore", publishVisibility);
    chat.on("closed", publishVisibility);
    chat.on("close", (event) => {
      if (this.isQuitting()) return;
      event.preventDefault();
      chat.hide();
      this.animate("farewell");
    });
    this.animate("greet");
    return chat;
  }
  openSettings() {
    const existing = this.windows.settings;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      return existing;
    }
    const panel = this.make("settings", {
      width: 478,
      height: 640,
      minWidth: 350,
      minHeight: 360,
      backgroundColor: "#fff9f5",
      maximizable: false
    });
    panel.once("ready-to-show", () => panel.show());
    panel.on("close", (event) => {
      if (!this.isQuitting()) {
        event.preventDefault();
        panel.hide();
      }
    });
    return panel;
  }
  updateSettings(settings) {
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
      const area = import_electron.screen.getDisplayMatching(bounds).workArea;
      const next = {
        ...size,
        x: bounds.x + bounds.width - size.width,
        y: bounds.y + bounds.height - size.height
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
    this.broadcast("settings:changed", settings);
  }
  reconcileDisplays() {
    for (const win of Object.values(this.windows)) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      const area = import_electron.screen.getDisplayMatching(bounds).workArea;
      const point = keepVisible(bounds, area);
      if (point.x !== bounds.x || point.y !== bounds.y) win.setPosition(point.x, point.y);
      if (win === this.windows.pet) this.db.savePosition(point);
    }
    this.pollPointer();
  }
  animate(animation, food, careId) {
    this.emit("pet", "pet:animation", animation, food, careId);
  }
  emit(kind, channel, ...args) {
    const win = this.windows[kind];
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
  }
  broadcast(channel, ...args) {
    for (const kind of Object.keys(this.windows)) this.emit(kind, channel, ...args);
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.stopFullscreenMonitor?.();
    this.tray?.destroy();
  }
};

// electron/main.ts
import_electron3.app.setName("Dr. Meow");
import_electron3.app.setAppUserModelId("org.drmeow.desktop");
var UserMessageError = class extends Error {
};
var smoke = process.argv.includes("--desktop-smoke");
if (smoke) {
  const profile = (0, import_node_path5.join)(import_electron3.app.getPath("temp"), "dr-meow-smoke-" + (0, import_node_crypto4.randomUUID)());
  (0, import_node_fs3.mkdirSync)(profile, { recursive: true });
  import_electron3.app.setPath("userData", profile);
}
if (!import_electron3.app.requestSingleInstanceLock()) import_electron3.app.quit();
else {
  void import_electron3.app.whenReady().then(launch).catch((error) => {
    console.error("Dr. Meow startup failed", error instanceof Error ? error.name + ": " + error.message : "Unknown");
    import_electron3.app.exit(1);
  });
}
function launch() {
  const development = !import_electron3.app.isPackaged && process.env.DR_MEOW_DEV === "1";
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    development ? "connect-src 'self' ws://127.0.0.1:4177" : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
  import_electron3.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  import_electron3.session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  import_electron3.session.defaultSession.setPermissionCheckHandler(() => false);
  import_electron3.session.defaultSession.on("will-download", (event) => event.preventDefault());
  const userData = import_electron3.app.getPath("userData");
  (0, import_node_fs3.mkdirSync)(userData, { recursive: true });
  const db = new LocalDatabase((0, import_node_path5.join)(userData, "dr-meow.sqlite"));
  const locale = () => db.settings().locale;
  const t = (chinese, english) => translate(locale(), chinese, english);
  const auth = new AuthService(userData, (url) => import_electron3.shell.openExternal(url), import_electron3.safeStorage, void 0, locale);
  const ai = new AiService((forceRefresh) => auth.accessToken(forceRefresh));
  let quitting = false;
  let modelCache;
  let active;
  let serviceStatus;
  let petAt = -Infinity;
  let pendingCare;
  let signInBusy = false;
  let authGeneration = 0;
  let resetting = false;
  const desktop = new DesktopWindows(db, () => quitting, !smoke);
  const all = ["pet", "chat", "settings"];
  const accountWindows = ["chat", "settings"];
  const chat = ["chat"];
  const pet = ["pet"];
  const settings = ["settings"];
  function handle(channel, kinds, fn) {
    import_electron3.ipcMain.handle(channel, (event, ...args) => {
      if (!desktop.owns(event, kinds)) throw new Error(t("\u64CD\u4F5C\u4E0D\u53EF\u7528\u3002", "This action is unavailable."));
      return fn(...args);
    });
  }
  function listen(channel, kinds, fn) {
    import_electron3.ipcMain.on(channel, (event, ...args) => {
      if (desktop.owns(event, kinds)) fn(event, ...args);
    });
  }
  function authStatus() {
    const value = auth.status();
    return serviceStatus && value.state === "connected" ? { ...value, state: serviceStatus } : value;
  }
  function quotaState(value = authStatus()) {
    if (value.state === "limited") return "limited";
    return auth.status().state === "connected" ? "view" : "connect";
  }
  function publishAuth(value = authStatus()) {
    for (const kind of accountWindows) desktop.emit(kind, "auth:status", value);
    desktop.emit("pet", "quota:changed", quotaState(value));
  }
  function historyChanged() {
    desktop.emit("chat", "chat:history");
  }
  function animateError(error) {
    desktop.animate("error");
    const code = error instanceof AuthError || error instanceof AiError ? error.code : void 0;
    if (code === "expired" || code === "network" || code === "ineligible") serviceStatus = code;
    if (code === "permission") serviceStatus = "ineligible";
    if (code === "limit") serviceStatus = "limited";
    if (serviceStatus || error instanceof AuthError) publishAuth();
  }
  async function models() {
    const generation = authGeneration;
    const profile = auth.status();
    const id = profile.account?.id;
    if (!id || profile.state !== "connected" && profile.state !== "expired") return [];
    if (modelCache && modelCache.account === id && modelCache.expires > Date.now()) return modelCache.models;
    try {
      const result = await ai.models();
      if (generation !== authGeneration || auth.status().account?.id !== id) return [];
      modelCache = { account: id, models: result, expires: Date.now() + 3e5 };
      if (serviceStatus && serviceStatus !== "limited") {
        serviceStatus = void 0;
        publishAuth();
      }
      return result;
    } catch (error) {
      if (generation !== authGeneration) return [];
      animateError(error);
      throw error;
    }
  }
  function publicError(error) {
    if (error instanceof AuthError || error instanceof AiError) return error.localized(locale());
    return t("\u64CD\u4F5C\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "Something went wrong. Please try again.");
  }
  function commitPetAction(action) {
    const now = Date.now();
    const saved = db.pet();
    const before = petAtTime(saved, now);
    const state = applyPetAction(saved, action, now);
    db.savePet(state);
    desktop.broadcast("pet:state", state, {
      fullness: Math.max(0, state.fullness - before.fullness),
      mood: Math.max(0, state.mood - before.mood),
      affection: Math.max(0, state.affection - before.affection)
    });
  }
  function runPetAction(action, source = "pet") {
    if (!action || resetting || !desktop.windows[source]?.isVisible()) return false;
    if (action.type === "feed" && !["fish", "can", "treat"].includes(action.food)) return false;
    if (!["pet", "feed", "play", "sleep", "wake"].includes(action.type)) return false;
    const now = performance.now();
    if (pendingCare && pendingCare.expiresAt < now) pendingCare = void 0;
    if (action.type === "sleep" && (pendingCare?.action.type === "sleep" || db.pet().restingSince !== void 0)) return false;
    if (now - petAt < 500 && action.type !== "wake") {
      if (!pendingCare) desktop.animate("blink");
      return false;
    }
    petAt = now;
    pendingCare = void 0;
    const animation = action.type === "pet" ? "petting" : action.type === "feed" ? "eating" : action.type === "play" ? "yarn" : action.type === "sleep" ? "sleeping" : "waking";
    const timing = careContacts[animation];
    const id = (0, import_node_crypto4.randomUUID)();
    pendingCare = { id, action, source, contactAt: now + timing.duration * timing.progress, expiresAt: now + timing.duration + 1500 };
    if (action.type !== "sleep" && action.type !== "wake") {
      const state = db.endPetRest();
      if (state) desktop.broadcast("pet:state", state);
    }
    const food = action.type === "feed" ? action.food : void 0;
    desktop.emit(source, "pet:animation", animation, food, id);
    if (source === "chat" && animation !== "waking") desktop.animate(animation, food);
    return true;
  }
  function localCommand(text) {
    const command = text.trim().replace(/[。！!.]+$/, "").toLowerCase();
    const name = petName(db.settings().petName).toLowerCase();
    if (command === "\u629A\u6478" + name || command === "\u6478\u6478" + name || command === "pet " + name) return { type: "pet" };
    if (command === name + "\u4F11\u606F" || command === name + ", go to sleep") return { type: "sleep" };
    if (command === name + "\u9192\u9192" || command === "wake up, " + name) return { type: "wake" };
    switch (command) {
      case "pet dr. meow":
      case "\u6478\u6478\u4F60":
      case "\u629A\u6478\u732B\u535A\u58EB":
        return { type: "pet" };
      case "feed dr. meow a fish":
      case "\u7ED9\u4F60\u4E00\u6761\u5C0F\u9C7C\u5E72":
      case "\u5582\u5C0F\u9C7C\u5E72":
        return { type: "feed", food: "fish" };
      case "feed dr. meow canned food":
      case "\u5582\u732B\u7F50\u5934":
        return { type: "feed", food: "can" };
      case "give dr. meow a treat":
      case "\u5582\u732B\u6761":
        return { type: "feed", food: "treat" };
      case "dr. meow, go to sleep":
      case "\u732B\u535A\u58EB\u4F11\u606F":
        return { type: "sleep" };
      case "wake up, dr. meow":
      case "\u732B\u535A\u58EB\u9192\u9192":
        return { type: "wake" };
    }
  }
  async function send(input, controller) {
    const prefs = db.settings();
    const t2 = translator(prefs.locale);
    const conversation = db.chat(input.id);
    if (!conversation) throw new Error(t2("\u627E\u4E0D\u5230\u8FD9\u4E2A\u5BF9\u8BDD\u3002", "This chat could not be found."));
    const messages2 = conversation.messages;
    const previous = messages2.at(-1);
    const priorUser = messages2.at(-2);
    const retry = input.retry === true && previous?.role === "assistant" && (previous.status === "cancelled" || previous.status === "error" || previous.search === "unavailable") && priorUser?.role === "user";
    if (input.retry && !retry) throw new Error(t2("\u8FD9\u6761\u56DE\u590D\u65E0\u6CD5\u91CD\u8BD5\u3002", "This reply cannot be retried."));
    const text = retry ? priorUser.text : input.text.trim();
    if (!text || text.length > 16e3) throw new Error(t2("\u8BF7\u8F93\u5165 1 \u5230 16,000 \u4E2A\u5B57\u7B26\u3002", "Enter between 1 and 16,000 characters."));
    const user = retry ? priorUser : { id: (0, import_node_crypto4.randomUUID)(), role: "user", text, createdAt: Date.now() };
    const response = {
      id: (0, import_node_crypto4.randomUUID)(),
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      status: "streaming"
    };
    const command = localCommand(text);
    if (!command) {
      let pet2 = db.currentPet();
      if (input.recover === true && careReason(pet2)) {
        pet2 = db.recoverPet();
        desktop.animate("happy");
      }
      desktop.broadcast("pet:state", pet2);
      if (careReason(pet2)) return { status: "care-required", pet: pet2 };
    }
    const publish = () => desktop.emit("chat", "chat:event", { conversationId: input.id, message: { ...response } });
    db.startTurn(input.id, user, response, retry ? previous.id : void 0);
    historyChanged();
    if (command) {
      const done = runPetAction(command, "chat");
      response.text = done ? t2("\u6536\u5230\uFF0C\u55B5\uFF01", "You got it, meow!") : t2("\u8BA9\u6211\u7F13\u4E00\u4E0B\uFF0C\u9A6C\u4E0A\u5C31\u597D\u3002", "Give me a moment, please.");
      response.status = "complete";
      db.updateMessage(response);
      publish();
      return { status: "complete" };
    }
    const rested = db.endPetRest();
    if (rested) desktop.broadcast("pet:state", rested);
    desktop.animate("thinking");
    let lastUpdate = 0;
    try {
      if (serviceStatus === "limited") throw new UserMessageError(t2("\u8BF7\u5148\u67E5\u770B ChatGPT \u7528\u91CF\uFF0C\u518D\u9009\u62E9\u6062\u590D\u8BF7\u6C42\u3002", "Check your ChatGPT usage, then choose Resume requests."));
      const catalog = await models();
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!catalog.length) {
        throw new UserMessageError(auth.status().state === "identity-only" ? t2("\u8BF7\u5728\u8D26\u53F7\u8BBE\u7F6E\u4E2D\u6388\u6743\u4F7F\u7528 ChatGPT \u5957\u9910\u3002", "Enable ChatGPT plan usage in your account settings.") : t2("\u8BF7\u5148\u8FDE\u63A5 ChatGPT \u5E76\u786E\u8BA4\u6709\u53EF\u7528\u6A21\u578B\u3002", "Connect ChatGPT and check that a model is available."));
      }
      const model = [input.model, prefs.model].find((id) => catalog.some((entry) => entry.id === id)) ?? catalog[0].id;
      const context = (retry ? messages2.slice(0, -2) : messages2).filter((message) => message.role === "user" || message.status === "complete" && message.text).slice(-16);
      const result = await ai.respond({
        model,
        messages: [...context, user],
        tone: prefs.tone,
        length: prefs.length,
        locale: prefs.locale,
        petName: prefs.petName,
        search: input.search === true,
        skipAutomaticSearch: retry && !input.search,
        signal: controller.signal,
        onDelta(delta) {
          if (!response.text) desktop.animate("speaking");
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
      response.status = "complete";
      response.error = result.warning;
      serviceStatus = void 0;
      publishAuth();
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof AiError && error.code === "cancelled";
      response.status = cancelled ? "cancelled" : "error";
      if (!cancelled) {
        response.error = error instanceof UserMessageError ? error.message : publicError(error);
        if (error instanceof AiError) {
          if (error.code === "search_unavailable") response.search = "unavailable";
          response.diagnostic = [
            error.stage,
            error.code,
            error.status === void 0 ? void 0 : "HTTP " + error.status,
            error.requestId ? "Request ID " + error.requestId : void 0
          ].filter(Boolean).join(" \xB7 ");
        }
        animateError(error);
      } else {
        desktop.animate("idle");
      }
    } finally {
      if (!quitting) {
        if (response.status === "complete") {
          const before = petAtTime(db.pet());
          const pet2 = db.completeChatReply(user.id, response, Date.now(), prefs.petName);
          if (pet2) desktop.broadcast("pet:state", pet2, {
            fullness: pet2.fullness - before.fullness,
            mood: pet2.mood - before.mood,
            affection: pet2.affection - before.affection
          });
          const mood = moodFor(pet2 ?? db.pet());
          desktop.animate(mood === "happy" || mood === "content" ? "happy" : "idle");
        } else {
          db.updateMessage(response);
        }
        publish();
      }
    }
    return { status: "complete" };
  }
  handle("settings:get", all, () => db.settings());
  handle("settings:update", ["pet", "chat", "settings"], (patch) => {
    const old = db.settings();
    if (!patch || typeof patch !== "object" || resetting) return old;
    const next = sanitizeSettings(patch, old);
    if (!smoke && import_electron3.app.isPackaged && next.startOnLogin !== old.startOnLogin) {
      import_electron3.app.setLoginItemSettings({ openAtLogin: next.startOnLogin });
    }
    db.saveSettings(next);
    desktop.updateSettings(next);
    if (next.locale !== old.locale) publishAuth();
    return next;
  });
  handle("pet:get", all, () => db.currentPet());
  handle("quota:get", all, () => quotaState());
  listen("quota:open", all, () => {
    void import_electron3.shell.openExternal(chatgptUsageUrl).catch(() => {
    });
  });
  handle("pet:action", pet, (action) => runPetAction(action));
  handle("chat:care", chat, (action) => runPetAction(action, "chat"));
  listen("pet:settle", ["pet", "chat"], (event, id) => {
    const pending = pendingCare;
    if (!pending || id !== pending.id || resetting || !desktop.owns(event, [pending.source]) || !desktop.windows[pending.source]?.isVisible()) return;
    const now = performance.now();
    if (now + 65 < pending.contactAt || now > pending.expiresAt) return;
    pendingCare = void 0;
    commitPetAction(pending.action);
    if (pending.source === "chat" && pending.action.type === "wake") desktop.animate("waking");
  });
  listen("pet:cancel", ["pet", "chat"], (event, id) => {
    if (pendingCare?.id === id && desktop.owns(event, [pendingCare.source])) pendingCare = void 0;
  });
  listen("pet:end-rest", pet, () => {
    if (resetting) return;
    const state = db.endPetRest();
    if (state) desktop.broadcast("pet:state", state);
  });
  handle("chat:visible", pet, () => desktop.chatVisible());
  listen("pet:hit", pet, (_event, hit) => desktop.setPetHit(hit === true));
  listen("pet:press", pet, (_event, pressed) => desktop.setPetPress(pressed === true));
  listen("pet:keyboard", pet, (_event, active2) => {
    const win = desktop.windows.pet;
    if (!win || win.isDestroyed()) return;
    win.setFocusable(active2 === true);
    if (active2 === true && win.isVisible()) win.focus();
  });
  listen("pet:drag", pet, (_event, phase) => desktop.petDrag(phase));
  listen("window:chat", all, (_event, search) => desktop.openChat(search === true));
  listen("window:settings", all, () => desktop.openSettings());
  listen("window:quit", pet, () => import_electron3.app.quit());
  listen("window:close", accountWindows, (event) => desktop.windows.chat?.webContents === event.sender ? desktop.windows.chat.close() : desktop.windows.settings?.close());
  listen("window:minimize", accountWindows, (event) => desktop.windows.chat?.webContents === event.sender ? desktop.windows.chat.minimize() : desktop.windows.settings?.minimize());
  listen("window:link", accountWindows, (_event, target) => {
    if (typeof target !== "string" || target.length > 8192) return;
    try {
      const url = new URL(target);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
      void import_electron3.shell.openExternal(url.href).catch(() => {
      });
    } catch {
    }
  });
  listen("window:copy", chat, (_event, text) => {
    if (typeof text === "string" && text.length <= 5e5) import_electron3.clipboard.writeText(text);
  });
  handle("auth:get", accountWindows, authStatus);
  handle("auth:signIn", accountWindows, async (options) => {
    if (signInBusy || resetting || active) return authStatus();
    signInBusy = true;
    const generation = ++authGeneration;
    try {
      const result = await auth.signIn({
        reconsent: options?.reconsent === true,
        addAccount: options?.addAccount === true,
        accountId: typeof options?.accountId === "string" ? options.accountId : void 0
      });
      if (generation !== authGeneration) return authStatus();
      const accepted = result.message === auth.status().message;
      if (accepted) {
        modelCache = void 0;
        serviceStatus = void 0;
        if (result.state === "connected" || result.state === "identity-only") desktop.animate("happy");
      }
      const status = !accepted && serviceStatus && result.state === "connected" ? { ...result, state: serviceStatus } : result;
      publishAuth(status);
      return status;
    } catch (error) {
      if (generation !== authGeneration) return authStatus();
      const state = error instanceof AuthError ? error.code : "error";
      const result = { ...auth.status(), state, message: publicError(error) };
      publishAuth(result);
      return result;
    } finally {
      signInBusy = false;
    }
  });
  listen("auth:cancel", accountWindows, () => auth.cancel());
  handle("auth:signOut", accountWindows, async () => {
    if (resetting) return authStatus();
    authGeneration++;
    auth.cancel();
    active?.controller.abort();
    await active?.finished;
    modelCache = void 0;
    serviceStatus = void 0;
    const result = await auth.signOut();
    publishAuth(result);
    return result;
  });
  handle("ai:models", accountWindows, async () => {
    try {
      return await models();
    } catch (error) {
      throw new Error(publicError(error));
    }
  });
  handle("ai:resume", accountWindows, () => {
    if (serviceStatus === "limited") serviceStatus = void 0;
    publishAuth();
    return authStatus();
  });
  handle("chat:list", chat, () => db.chats());
  handle("chat:new", chat, () => {
    if (resetting) throw new Error(t("\u6B63\u5728\u6E05\u9664\u6570\u636E\u3002", "Local data is being cleared."));
    const result = db.createChat();
    historyChanged();
    return result;
  });
  handle("chat:rename", chat, (id, title) => {
    if (typeof id !== "string" || typeof title !== "string" || !title.trim() || resetting) return;
    db.rename(id, title.trim().slice(0, 120));
    historyChanged();
  });
  handle("chat:delete", chat, async (id) => {
    if (typeof id !== "string" || resetting) return;
    if (active?.id === id) {
      active.controller.abort();
      await active.finished;
    }
    db.remove(id);
    historyChanged();
  });
  handle("chat:send", chat, async (input) => {
    if (!input || typeof input.text !== "string" || typeof input.id !== "string") throw new Error(t("\u65E0\u6548\u7684\u6D88\u606F\u3002", "Invalid message."));
    if (active || resetting || signInBusy) throw new Error(t("\u8BF7\u7B49\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210\u540E\u518D\u53D1\u9001\u3002", "Wait for the current action to finish before sending."));
    const request = { id: input.id, controller: new AbortController(), finished: void 0 };
    active = request;
    try {
      request.finished = send(input, request.controller);
      return await request.finished;
    } finally {
      if (active === request) active = void 0;
    }
  });
  listen("chat:cancel", chat, () => active?.controller.abort());
  handle("data:clearChats", settings, async () => {
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
  handle("data:resetPet", settings, () => {
    if (resetting) return;
    pendingCare = void 0;
    db.resetPet();
    desktop.broadcast("pet:state", db.pet());
    desktop.animate("idle");
  });
  handle("data:clear", settings, async () => {
    if (resetting) return;
    resetting = true;
    pendingCare = void 0;
    try {
      authGeneration++;
      auth.cancel();
      active?.controller.abort();
      await active?.finished;
      const authResult = await auth.reset();
      modelCache = void 0;
      serviceStatus = void 0;
      if (!smoke && import_electron3.app.isPackaged && db.settings().startOnLogin) import_electron3.app.setLoginItemSettings({ openAtLogin: false });
      db.clearAll();
      await import_electron3.session.defaultSession.clearStorageData({ storages: ["localstorage"] });
      desktop.updateSettings(db.settings());
      desktop.broadcast("pet:state", db.pet());
      desktop.animate("idle");
      publishAuth(authResult);
      historyChanged();
    } finally {
      resetting = false;
    }
  });
  desktop.start();
  import_electron3.app.on("second-instance", () => desktop.openChat());
  import_electron3.app.on("activate", () => desktop.openChat());
  import_electron3.app.on("window-all-closed", () => import_electron3.app.quit());
  import_electron3.powerMonitor.on("resume", () => {
    modelCache = void 0;
    desktop.reconcileDisplays();
    publishAuth();
  });
  import_electron3.app.on("before-quit", () => {
    quitting = true;
    auth.cancel();
    active?.controller.abort();
    desktop.close();
  });
  import_electron3.app.on("will-quit", () => db.close());
  if (smoke) {
    void Promise.resolve().then(() => (init_desktopSmoke(), desktopSmoke_exports)).then(({ runDesktopSmoke: runDesktopSmoke2 }) => runDesktopSmoke2(desktop)).then(() => import_electron3.app.quit(), (error) => {
      console.error("Desktop smoke test failed", error);
      import_electron3.app.exit(1);
    });
  }
}
