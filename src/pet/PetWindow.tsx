import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import type { Animation, Food, PetAction, PetGains, PetState, Point, QuotaState, Settings, SkinId } from '../../shared/contracts.ts';
import { translator } from '../../shared/i18n.ts';
import { moodFor, type Mood } from '../../shared/petCare.ts';
import { AnimationStateMachine, IdleActivityRotation, isIdleActivity } from './AnimationStateMachine.ts';
import type { PetFrame } from './AnimationStateMachine.ts';
import {
  classifyGesture, DOUBLE_CLICK_MS, hitAlpha, hoverIntent, HOVER_CLOSE_MS, HOVER_OPEN_MS,
  isDoubleClick, MASK_SIZE, trackMovement,
} from './gestures.ts';
import type { Gesture } from './gestures.ts';
import { PetLabeledAction, PetStatusCard } from './PetStatusCard.tsx';
import type { PetSymbol } from './PetIcon.tsx';
import { PetScene } from './PetScene.tsx';
import type { ClipName } from './frameAssets.ts';
import { skinHead } from './portrait.ts';

type Press = Gesture & { pointerId: number; dragging: boolean };
type TimedPoint = Point & { time: number };
type Menu = 'context' | 'peek' | 'status' | 'status-food';

function isStatusMenu(menu?: Menu): boolean {
  return menu === 'peek' || menu === 'status' || menu === 'status-food';
}

function inside(point: Point, box: DOMRect): boolean {
  return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom;
}

export default function PetWindow() {
  const [settings, setSettings] = useState<Settings>();
  const [pet, setPet] = useState<PetState>();
  const [quota, setQuota] = useState<QuotaState>();
  const [mood, setMood] = useState<Mood>('calm');
  const [gains, setGains] = useState<PetGains>();
  const [menu, renderMenu] = useState<Menu>();
  const [frame, setFrame] = useState<PetFrame>({ animation: 'idle' });
  const [idleRotation] = useState(() => new IdleActivityRotation());
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)'));
  const machine = useRef(new AnimationStateMachine(true));
  const portrait = useRef<HTMLImageElement>(null);
  const target = useRef<HTMLButtonElement>(null);
  const poseLayer = useRef<HTMLSpanElement>(null);
  const restingRef = useRef(false);
  const popup = useRef<HTMLDivElement>(null);
  const mask = useRef<Uint8ClampedArray>(null);
  const pointer = useRef<Point | null>(null);
  const hit = useRef(false);
  const press = useRef<Press>(null);
  const click = useRef<TimedPoint>(null);
  const clickTimeout = useRef<number>(0);
  const animationTimeout = useRef<number>(0);
  const lastInteraction = useRef(performance.now());
  const activeMenu = useRef<Menu>(undefined);
  const hoverTimer = useRef<{ intent: 'show' | 'hide'; id: number }>(undefined);
  const hoverBlocked = useRef(false);
  const petVersion = useRef(0);
  const petDirection = useRef(1);
  const gainTimeout = useRef<number>(0);
  const previousAnimation = useRef<Animation>('idle');
  const activeCare = useRef<{ id: string; animation: Animation }>(undefined);
  const chatVisible = useRef(true);
  const quiet = settings?.quiet ?? true;
  const quietMode = useRef(quiet);
  const skin = settings?.skin ?? 'original';
  const displayedSkin = useRef<SkinId>(skin);
  const t = translator(settings?.locale);

  const cancelCare = useCallback(() => {
    const care = activeCare.current;
    if (!care) return;
    activeCare.current = undefined;
    window.meow.cancelPetAction(care.id);
    if (care.animation === 'waking') window.meow.endPetRest();
  }, []);

  const settleCare = useCallback((id: string) => {
    if (activeCare.current?.id !== id || document.hidden) return;
    activeCare.current = undefined;
    window.meow.settlePetAction(id);
  }, []);

  const paint = useCallback(function drawFrame() {
    window.clearTimeout(animationTimeout.current);
    const now = performance.now();
    const next = machine.current.frame(now);
    const care = activeCare.current;
    if (care && care.animation !== next.animation) cancelCare();
    if (previousAnimation.current === 'sleeping' && next.animation !== 'sleeping' &&
      next.animation !== 'dragging' && care?.animation !== 'waking') window.meow.endPetRest();
    previousAnimation.current = next.animation;
    setFrame(next);
    if (next.until !== undefined) {
      animationTimeout.current = window.setTimeout(drawFrame, Math.max(1, next.until - now));
    }
  }, [cancelCare]);

  const finishPlayback = useCallback((_clip: ClipName, until?: number) => {
    if (until !== undefined && machine.current.finish(until, performance.now())) paint();
  }, [paint]);

  const play = useCallback((animation: Animation, food?: Food, manual = false) => {
    machine.current.play(animation, performance.now(), food, manual);
    paint();
  }, [paint]);

  const cancelIdleActivity = useCallback(() => {
    if (machine.current.cancelIdleActivity()) paint();
  }, [paint]);

  const mayAnimateAutonomously = useCallback(() => {
    return !quietMode.current && !reducedMotion.matches && !document.hidden &&
      !chatVisible.current && !press.current && !hit.current && !activeMenu.current;
  }, [reducedMotion]);

  const normalizedPoint = useCallback((point: Point): Point | undefined => {
    const targetBox = target.current?.getBoundingClientRect();
    if (!targetBox || !inside(point, targetBox)) return;
    const box = poseLayer.current?.getBoundingClientRect() ?? targetBox;
    return { x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height };
  }, []);

  const onBedding = useCallback((point: Point) => {
    if (!restingRef.current) return false;
    const box = target.current?.getBoundingClientRect();
    if (!box || !inside(point, box)) return false;
    const x = (point.x - box.x) / box.width;
    const y = (point.y - box.y) / box.height;
    return ((x - .51) / .448) ** 2 + ((y - .83) / .15) ** 2 <= 1;
  }, []);

  const onCat = useCallback((point: Point) => {
    const normalized = normalizedPoint(point);
    return onBedding(point) || !!(normalized && mask.current && hitAlpha(mask.current, normalized));
  }, [normalizedPoint, onBedding]);

  const clearHover = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.id);
    hoverTimer.current = undefined;
  }, []);

  const setMenu = useCallback((next?: Menu) => {
    clearHover();
    const previous = activeMenu.current;
    if (next === previous) return;
    activeMenu.current = next;
    renderMenu(next);
    const keyboard = (value?: Menu) => value !== undefined && value !== 'peek';
    if (keyboard(previous) !== keyboard(next)) window.meow.petKeyboard(keyboard(next));
    if (next) cancelIdleActivity();
    if (!previous && next) {
      const version = ++petVersion.current;
      void window.meow.getPet().then(value => {
        if (petVersion.current === version) setPet(value);
      }).catch(() => undefined);
    }
  }, [cancelIdleActivity, clearHover]);

  const refreshPointer = useCallback((point: Point | null) => {
    pointer.current = point;
    const normalized = point ? normalizedPoint(point) : undefined;
    const onArtwork = !!(normalized && mask.current && hitAlpha(mask.current, normalized));
    const popupBox = popup.current?.getBoundingClientRect();
    const onPopup = !!(point && popupBox && inside(point, popupBox));
    const onBed = !!(point && onBedding(point));
    const interactive = !!press.current || onArtwork || onBed || onPopup;
    if (interactive !== hit.current) {
      hit.current = interactive;
      window.meow.petHit(interactive);
    }
    if (interactive) {
      lastInteraction.current = performance.now();
      cancelIdleActivity();
    }

    if (press.current || click.current) {
      clearHover();
      return;
    }
    const current = activeMenu.current;
    const onHead = !!(!onBed && onArtwork && normalized && skinHead(displayedSkin.current, normalized));
    if (!onHead) hoverBlocked.current = false;
    const targetBox = target.current?.getBoundingClientRect();
    // Keep the panel open on the way from the head while the transparent gap remains click-through.
    const between = !!(point && popupBox && targetBox && point.y >= popupBox.bottom &&
      point.y < targetBox.top + targetBox.height * .34 &&
      point.x >= Math.max(popupBox.left, targetBox.left) && point.x < Math.min(popupBox.right, targetBox.right));
    const keepOpen = current === 'peek' ? onHead : onArtwork || onBed;
    const intent = hoverIntent(!!current, current ? keepOpen : onHead && !hoverBlocked.current, onPopup || between);
    if (intent === hoverTimer.current?.intent) return;
    clearHover();
    if (!intent) return;
    hoverTimer.current = {
      intent,
      id: window.setTimeout(() => setMenu(intent === 'show' ? 'peek' : undefined),
        intent === 'show' ? HOVER_OPEN_MS : HOVER_CLOSE_MS),
    };
  }, [cancelIdleActivity, clearHover, normalizedPoint, onBedding, setMenu]);

  const releasePress = useCallback(() => {
    const held = press.current;
    press.current = null;
    if (held?.dragging) {
      window.meow.petDrag('end');
      machine.current.setDragging(false);
      paint();
    }
    if (held) window.meow.petPress(false);
    return held;
  }, [paint]);

  const clearClick = useCallback(() => {
    window.clearTimeout(clickTimeout.current);
    click.current = null;
  }, []);

  const refreshMask = useCallback(() => {
    const body = portrait.current;
    if (body?.complete && body.naturalWidth) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = MASK_SIZE;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(body, 0, 0, MASK_SIZE, MASK_SIZE);
        mask.current = context.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
      }
    }
    refreshPointer(pointer.current);
  }, [refreshPointer]);

  useLayoutEffect(() => {
    displayedSkin.current = skin;
    mask.current = null;
    clearHover();
    refreshMask();
  }, [clearHover, refreshMask, skin]);

  const resting = frame.animation === 'sleeping';
  useLayoutEffect(() => {
    restingRef.current = resting;
    refreshPointer(pointer.current);
  }, [refreshPointer, menu, resting, settings?.size]);

  useLayoutEffect(() => {
    if (menu && menu !== 'peek') {
      const first = popup.current?.querySelector<HTMLButtonElement>('.pet-status-actions button, .pet-context-panel button');
      first?.focus({ preventScroll: true });
    }
  }, [menu]);

  useEffect(() => { if (pet) setMood(previous => moodFor(pet, previous)); }, [pet]);

  useLayoutEffect(() => {
    quietMode.current = quiet;
    if (quiet) cancelIdleActivity();
  }, [cancelIdleActivity, quiet]);

  useEffect(() => {
    let mounted = true;
    let receivedSettings = false;
    let receivedQuota = false;
    let receivedChatVisibility = false;
    function setChatVisible(visible: boolean) {
      chatVisible.current = visible;
      lastInteraction.current = performance.now();
      if (visible) cancelIdleActivity();
    }
    const unlisten = [
      window.meow.onSettings(value => {
        receivedSettings = true;
        setSettings(value);
      }),
      window.meow.onAnimation((animation, food, careId) => {
        if (careId) {
          cancelCare();
          activeCare.current = { id: careId, animation };
          lastInteraction.current = performance.now();
          play(animation, food, true);
          return;
        }
        if (isIdleActivity(animation)) {
          if (mayAnimateAutonomously()) play(animation);
          return;
        }
        lastInteraction.current = performance.now();
        play(animation, food);
      }),
      window.meow.onPetState((value, delta) => {
        petVersion.current++;
        setPet(value);
        if (delta && Object.values(delta).some(value => value > 0)) {
          setGains(delta);
          window.clearTimeout(gainTimeout.current);
          gainTimeout.current = window.setTimeout(() => setGains(undefined), 1050);
        }
      }),
      window.meow.onQuotaState(value => {
        receivedQuota = true;
        setQuota(value);
      }),
      window.meow.onChatVisibility(visible => {
        receivedChatVisibility = true;
        setChatVisible(visible);
      }),
      window.meow.onPointer(refreshPointer),
    ];
    function cancelOnHide() {
      lastInteraction.current = performance.now();
      if (!document.hidden) return;
      cancelCare();
      cancelIdleActivity();
      const held = releasePress();
      if (held && target.current?.hasPointerCapture(held.pointerId)) {
        target.current.releasePointerCapture(held.pointerId);
      }
      clearClick();
      setMenu(undefined);
      refreshPointer(null);
    }
    document.addEventListener('visibilitychange', cancelOnHide);
    async function refreshStats(restore = false) {
      const version = petVersion.current;
      const value = await window.meow.getPet().catch(() => undefined);
      if (!value || !mounted || petVersion.current !== version) return;
      setPet(value);
      if (restore && value.restingSince !== undefined && machine.current.frame(performance.now()).animation === 'idle') {
        play('sleeping', undefined, true);
      }
    }
    void refreshStats(true);
    const statsTimer = window.setInterval(() => { if (!document.hidden) void refreshStats(); }, 240_000);
    void window.meow.getSettings().then(value => {
      if (mounted && !receivedSettings) setSettings(value);
    }).catch(() => undefined);
    void window.meow.getQuotaState().then(value => {
      if (mounted && !receivedQuota) setQuota(value);
    }).catch(() => undefined);
    void window.meow.getChatVisible().then(visible => {
      if (mounted && !receivedChatVisibility) setChatVisible(visible);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unlisten.forEach(stop => stop());
      document.removeEventListener('visibilitychange', cancelOnHide);
      window.clearInterval(statsTimer);
      window.clearTimeout(gainTimeout.current);
      cancelCare();
      clearClick();
      clearHover();
      petVersion.current++;
      window.clearTimeout(animationTimeout.current);
      if (press.current?.dragging) window.meow.petDrag('end');
      if (press.current) window.meow.petPress(false);
      window.meow.petHit(false);
    };
  }, [cancelCare, cancelIdleActivity, clearClick, clearHover, mayAnimateAutonomously, play, refreshPointer, releasePress, setMenu]);

  useEffect(() => {
    if (quiet) return;
    let timer: number;
    let activityAt = performance.now() + 16_000 + Math.random() * 12_000;
    function schedule() {
      timer = window.setTimeout(() => {
        const now = performance.now();
        if (mayAnimateAutonomously() && machine.current.frame(now).animation === 'idle') {
          const idleFor = now - lastInteraction.current;
          const random = Math.random();
          if (idleFor > 360_000 && random < 0.16) {
            play('sleeping');
          } else if (idleFor >= 9000 && now >= activityAt) {
            play(idleRotation.next());
            activityAt = now + 45_000 + Math.random() * 35_000;
          } else if (random < .72) {
            play('blink');
          }
        }
        schedule();
      }, 3900 + Math.random() * 5600);
    }
    function applyMotionPreference() {
      window.clearTimeout(timer);
      if (reducedMotion.matches) cancelIdleActivity();
      else schedule();
    }
    applyMotionPreference();
    reducedMotion.addEventListener('change', applyMotionPreference);
    return () => {
      window.clearTimeout(timer);
      reducedMotion.removeEventListener('change', applyMotionPreference);
    };
  }, [cancelIdleActivity, idleRotation, mayAnimateAutonomously, play, quiet, reducedMotion]);

  function perform(action: PetAction, direction = 1) {
    if (action.type === 'pet') petDirection.current = direction;
    lastInteraction.current = performance.now();
    if (activeMenu.current === 'status-food') setMenu('status');
    void window.meow.petAction(action).catch(() => undefined);
  }

  function openChat() {
    clearClick();
    lastInteraction.current = performance.now();
    hoverBlocked.current = true;
    setMenu(undefined);
    window.meow.openChat();
  }

  function toggleStatus() {
    clearClick();
    const current = activeMenu.current;
    const closing = current === 'status' || current === 'status-food';
    hoverBlocked.current = closing;
    setMenu(closing ? undefined : 'status');
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || press.current) return;
    const point = { x: event.clientX, y: event.clientY };
    const normalized = normalizedPoint(point);
    if (!onCat(point)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    press.current = {
      origin: { x: event.screenX, y: event.screenY },
      head: !!(normalized && !onBedding(point) && skinHead(skin, normalized)),
      size: settings?.size ?? 180,
      distance: 0,
      pointerId: event.pointerId,
      dragging: false,
    };
    lastInteraction.current = performance.now();
    refreshPointer(point);
    window.meow.petPress(true);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const held = press.current;
    if (!held || held.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishPress(event, true);
      return;
    }
    if (held.dragging) {
      window.meow.petDrag('move');
    } else if (trackMovement(held, { x: event.screenX, y: event.screenY }) && !settings?.positionLocked) {
      clearClick();
      setMenu(undefined);
      held.dragging = true;
      machine.current.setDragging(true);
      paint();
      window.meow.petDrag('start');
    }
  }

  function finishPress(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const held = press.current;
    if (!held || held.pointerId !== event.pointerId) return;
    releasePress();
    refreshPointer(cancelled ? null : { x: event.clientX, y: event.clientY });
    if (held.dragging || cancelled) {
      clearClick();
      return;
    }
    const end = { x: event.screenX, y: event.screenY };
    trackMovement(held, end);
    const kind = classifyGesture(held);
    if (kind === 'pet') {
      clearClick();
      perform({ type: 'pet' }, end.x > held.origin.x ? -1 : 1);
    } else if (kind === 'drag') {
      clearClick();
    } else {
      const next = { ...end, time: performance.now() };
      if (click.current && isDoubleClick(click.current, next)) {
        openChat();
      } else {
        clearClick();
        click.current = next;
        clearHover();
        clickTimeout.current = window.setTimeout(toggleStatus, DOUBLE_CLICK_MS);
      }
    }
  }

  function contextMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (press.current || !onCat({ x: event.clientX, y: event.clientY })) return;
    clearClick();
    hoverBlocked.current = true;
    const current = activeMenu.current;
    setMenu(current === 'context' ? undefined : 'context');
  }

  function togglePosition() {
    setMenu(undefined);
    void window.meow.updateSettings({ positionLocked: !settings?.positionLocked }).catch(() => undefined);
  }

  const statusOpen = isStatusMenu(menu);
  const feeding = menu === 'status-food';
  const rest = () => perform({ type: resting ? 'wake' : 'sleep' });
  const gainIcon: PetSymbol | undefined = gains?.fullness ? 'bowl' : gains?.affection ? 'heart' : gains?.mood ? 'mood' : undefined;
  return (
    <main
      className="pet-stage"
      style={{ '--pet-size': `${settings?.size ?? 180}px`, '--pet-opacity': settings?.opacity ?? 1 } as CSSProperties}
      data-motion={settings?.animation ?? 'full'}
      data-quiet={settings?.quiet || undefined}
      onPointerMove={event => refreshPointer({ x: event.clientX, y: event.clientY })}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          clearClick();
          hoverBlocked.current = true;
          setMenu(undefined);
        }
      }}
    >
      <button
        type="button"
        className="pet-target"
        data-locked={settings?.positionLocked || undefined}
        aria-expanded={statusOpen}
        aria-controls={statusOpen ? 'dr-meow-status' : undefined}
        aria-label={t(
          '猫博士，单击打开状态和互动，双击聊天，按住头部轻扫抚摸，右键打开菜单',
          'Dr. Meow. Click for status and interactions, double-click to chat, hold and stroke the head to pet, or right-click for the menu.',
        )}
        ref={target}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={event => finishPress(event)}
        onPointerCancel={event => finishPress(event, true)}
        onLostPointerCapture={event => finishPress(event, true)}
        onContextMenu={contextMenu}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!event.repeat) toggleStatus();
          }
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            setMenu('context');
          }
        }}
      >
        <PetScene frame={frame} skin={skin} portrait={portrait} poseLayer={poseLayer}
          petDirection={petDirection.current} gentle={quiet || settings?.animation === 'gentle'}
          onArtChange={refreshMask} mood={mood} gain={gainIcon} careId={activeCare.current?.id} onContact={settleCare}
          revision={frame.until} onPlaybackEnd={finishPlayback} />
      </button>
      {menu && (
        <div className={statusOpen ? 'pet-popover pet-status-panel' : 'pet-popover pet-context-panel'} ref={popup} role="group"
          id={statusOpen ? 'dr-meow-status' : undefined}
          aria-label={statusOpen ? t('猫博士状态', 'Dr. Meow’s status') : t('猫博士菜单', 'Dr. Meow menu')}>
          {statusOpen && <PetStatusCard pet={pet} mood={mood} gains={gains} quota={quota}
            animation={frame.animation} compact={menu === 'peek'} t={t} chat={openChat} petCat={() => perform({ type: 'pet' })}
            foodMenu={feeding ? { back: () => setMenu('status'), choose: food => perform({ type: 'feed', food }) } : undefined}
            feed={() => setMenu('status-food')} play={() => perform({ type: 'play' })} rest={rest}
            usage={() => window.meow.openUsage()} />}
          {menu === 'context' && <>
            <PetLabeledAction name="pin" label={settings?.positionLocked ? t('解除固定', 'Unlock position') : t('固定位置', 'Lock position')}
              pressed={settings?.positionLocked ?? false} onClick={togglePosition} />
            <PetLabeledAction name="settings" label={t('设置', 'Settings')} onClick={() => { setMenu(undefined); window.meow.openSettings(); }} />
            <PetLabeledAction name="exit" label={t('退出', 'Quit')} onClick={() => window.meow.quit()} />
          </>}
        </div>
      )}
    </main>
  );
}
