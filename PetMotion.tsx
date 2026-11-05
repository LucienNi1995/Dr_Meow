import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SkinId } from '../../shared/contracts.ts';
import type { Mood } from '../../shared/petCare.ts';
import type { PetFrame } from './AnimationStateMachine.ts';
import { loadFrameAtlas, type ClipName, type FrameAtlas } from './frameAssets.ts';

interface VisibleFrame {
  atlas: FrameAtlas;
  index: number;
  request: string;
}

interface BridgeFrame {
  atlas: FrameAtlas;
  index: number;
  hold: number;
}

const readyClips = [
  'idle', 'petting-left', 'petting-right', 'eating-fish', 'eating-can', 'eating-treat',
  'sleeping', 'sleeping-loop', 'waking', 'yarn', 'dragging', 'drag-end',
] as const satisfies readonly ClipName[];

function requestedClip(frame: PetFrame, mood: Mood | undefined, direction: number): ClipName {
  switch (frame.animation) {
    case 'idle': return mood && mood !== 'calm' ? `idle-${mood}` : 'idle';
    case 'petting': return direction < 0 ? 'petting-left' : 'petting-right';
    case 'eating': return `eating-${frame.food ?? 'fish'}`;
    default: return frame.animation;
  }
}

function bridgeFrames(atlas: FrameAtlas, from: number, to: number): BridgeFrame[] {
  const step = Math.sign(to - from);
  if (!step) return [];
  const indices = Array.from({ length: Math.abs(to - from) }, (_, i) => from + (i + 1) * step);
  const total = indices.reduce((time, index) => time + atlas.timeline.holds[index], 0);
  const factor = Math.min(1, 460 / total);
  return indices.map(index => ({ atlas, index, hold: Math.max(9, atlas.timeline.holds[index] * factor) }));
}

function exitFrom(current: VisibleFrame, allowReverse = true): BridgeFrame[] {
  const { atlas, index } = current;
  const { safeFrames, holds, contactFrame, loopFrom } = atlas.timeline;
  if (safeFrames?.includes(index)) return [];
  if (allowReverse && contactFrame !== undefined && index < contactFrame) return bridgeFrames(atlas, index, 0);
  if (loopFrom !== undefined) {
    const next = safeFrames?.find(frame => frame > index);
    if (next !== undefined) return bridgeFrames(atlas, index, next);
    if (index <= loopFrom) return bridgeFrames(atlas, index, 0);
    // The tail of a loop returns to its entrance pose. Retrace that entrance to sit.
    return [
      ...bridgeFrames(atlas, index, holds.length - 1),
      ...bridgeFrames(atlas, loopFrom, 0),
    ];
  }
  return bridgeFrames(atlas, index, holds.length - 1);
}

async function makeBridge(current: VisibleFrame, next: FrameAtlas): Promise<{ frames: BridgeFrame[]; skipWakeEntry?: boolean }> {
  const { atlas, index } = current;
  const { clip, timeline } = atlas;
  if (clip.startsWith('idle') || clip === 'blink') return { frames: [], skipWakeEntry: next.clip === 'waking' };
  if (clip === 'sleeping' && index < (timeline.contactFrame ?? timeline.holds.length - 1)) {
    return { frames: exitFrom(current), skipWakeEntry: next.clip === 'waking' };
  }
  if (clip === 'sleeping' || clip === 'sleeping-loop') {
    const finishTucking = clip === 'sleeping' ? exitFrom(current, false) : [];
    if (next.clip === 'waking') return { frames: finishTucking };
    const wake = await loadFrameAtlas(atlas.skin, 'waking');
    return { frames: [...finishTucking, ...bridgeFrames(wake, -1, wake.timeline.holds.length - 1)] };
  }
  if (clip === 'dragging') {
    if (index < (timeline.loopFrom ?? 0)) return { frames: bridgeFrames(atlas, index, 0) };
    const land = await loadFrameAtlas(atlas.skin, 'drag-end');
    return { frames: bridgeFrames(land, -1, land.timeline.holds.length - 1) };
  }
  return { frames: exitFrom(current), skipWakeEntry: next.clip === 'waking' };
}

interface Props {
  frame: PetFrame;
  skin: SkinId;
  mood?: Mood;
  gentle: boolean;
  reduced: boolean;
  petDirection: number;
  revision?: number;
  careId?: string;
  onContact?: (id: string) => void;
  warm?: boolean;
  onPlaybackStart?: (clip: ClipName, revision?: number) => void;
  onPlaybackEnd?: (clip: ClipName, revision?: number) => void;
}

export function PetMotion({
  frame, skin, mood, gentle, reduced, petDirection, revision, careId, onContact, warm,
  onPlaybackStart, onPlaybackEnd,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const visible = useRef<VisibleFrame>(undefined);
  const events = useRef({ careId, onContact, onPlaybackStart, onPlaybackEnd });
  const reported = useRef<string>(undefined);
  const clip = requestedClip(frame, mood, petDirection);
  const request = [skin, clip, frame.until, revision].join('/');

  useLayoutEffect(() => {
    events.current = { careId, onContact, onPlaybackStart, onPlaybackEnd };
  }, [careId, onContact, onPlaybackStart, onPlaybackEnd]);

  useEffect(() => {
    if (!warm) return;
    let canceled = false;
    async function preload() {
      for (const candidate of readyClips) {
        if (canceled) return;
        await loadFrameAtlas(skin, candidate).catch(() => undefined);
      }
    }
    void preload();
    return () => { canceled = true; };
  }, [skin, warm]);

  useLayoutEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext('2d');
    if (!surface || !context) return;
    const element = surface;
    const painter = context;
    let stopped = false;
    let timer = 0;
    let raf = 0;
    let origin = visible.current;
    if (origin?.atlas.skin !== skin) {
      delete element.dataset.ready;
      visible.current = origin = undefined;
    }

    function queue(wait: number, tick: FrameRequestCallback) {
      if (stopped) return;
      if (wait > 19) timer = window.setTimeout(() => { raf = requestAnimationFrame(tick); }, wait - 7);
      else raf = requestAnimationFrame(tick);
    }

    function draw(atlas: FrameAtlas, index: number, owner: string) {
      if (visible.current?.atlas === atlas && visible.current.index === index && visible.current.request === owner) return;
      const { width, height, columns } = atlas.timeline;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      painter.clearRect(0, 0, width, height);
      painter.drawImage(atlas.image, index % columns * width, Math.floor(index / columns) * height,
        width, height, 0, 0, width, height);
      visible.current = { atlas, index, request: owner };
      element.dataset.ready = 'true';
    }

    function playAtlas(atlas: FrameAtlas, resume = 0, skipWakeEntry = false, after?: () => void) {
      const { holds, starts, duration, loopFrom, contactFrame } = atlas.timeline;
      const last = holds.length - 1;
      const speed = gentle && loopFrom !== undefined && atlas.clip !== 'dragging' ? 1.4 : 1;
      const loopStart = loopFrom === undefined ? 0 : starts[loopFrom];
      const began = performance.now() - resume * speed;
      let passedContact = resume > (contactFrame === undefined ? Infinity : starts[contactFrame]);
      function tick(now: number) {
        if (stopped) return;
        const elapsed = Math.max(0, now - began) / speed;
        const settled = elapsed >= duration;
        const time = settled && loopFrom !== undefined
          ? loopStart + (elapsed - loopStart) % (duration - loopStart) : Math.min(elapsed, duration);
        const index = starts.findLastIndex(start => start <= time);
        if (contactFrame !== undefined && !passedContact && elapsed >= starts[contactFrame]) {
          draw(atlas, contactFrame, request);
          passedContact = true;
          const event = events.current;
          if (event.careId && event.careId !== reported.current && !document.hidden) {
            reported.current = event.careId;
            event.onContact?.(event.careId);
          }
          queue(0, tick);
          return;
        }
        if (reduced) {
          if (after && atlas.clip === 'sleeping' && !settled) {
            if (passedContact) draw(atlas, last, request);
          } else if (contactFrame !== undefined && !settled) {
            if (passedContact) draw(atlas, contactFrame, request);
          } else if (loopFrom !== undefined || settled || atlas.clip.startsWith('idle')) {
            draw(atlas, loopFrom ?? last, request);
          }
        } else if (!skipWakeEntry || passedContact) {
          draw(atlas, index, request);
        }
        if (settled && (loopFrom === undefined || reduced)) {
          if (atlas.clip === clip && loopFrom === undefined) events.current.onPlaybackEnd?.(clip, revision);
          after?.();
          return;
        }
        if (last === 0 && loopFrom !== undefined) return;
        if (reduced) {
          const eventAt = contactFrame !== undefined && !passedContact ? starts[contactFrame] : duration;
          if (loopFrom === undefined || !passedContact) queue((eventAt - elapsed) * speed, tick);
          return;
        }
        const nextAt = starts[index + 1] ?? duration;
        queue((nextAt - time) * speed, tick);
      }
      tick(performance.now());
    }

    function playBridge(steps: BridgeFrame[], next: () => void) {
      if (!steps.length || reduced) return next();
      const owner = origin?.request ?? '';
      let total = 0;
      const starts = steps.map(step => {
        const start = total;
        total += step.hold;
        return start;
      });
      const began = performance.now();
      function drawStep(now: number) {
        if (stopped) return;
        const elapsed = Math.max(0, now - began);
        const index = starts.findLastIndex(start => start <= elapsed);
        const step = steps[index];
        draw(step.atlas, step.index, owner);
        if (elapsed >= total) next();
        else queue((starts[index + 1] ?? total) - elapsed, drawStep);
      }
      drawStep(began);
    }

    async function begin() {
      const atlas = await loadFrameAtlas(skin, clip);
      if (stopped) return;
      const rest = clip === 'sleeping' ? loadFrameAtlas(skin, 'sleeping-loop') : undefined;
      void rest?.catch(() => undefined);
      const sleep = rest ? () => {
        void rest.then(loop => {
          if (!stopped) playAtlas(loop);
        }).catch(() => undefined);
      } : undefined;
      if (origin?.request === request) {
        if (origin.atlas.clip === 'sleeping-loop') playAtlas(origin.atlas, origin.atlas.timeline.starts[origin.index]);
        else playAtlas(atlas, atlas.timeline.starts[origin.index], false, sleep);
        return;
      }
      const bridge = origin ? await makeBridge(origin, atlas) : { frames: [], skipWakeEntry: clip === 'waking' };
      if (!stopped) playBridge(bridge.frames, () => {
        events.current.onPlaybackStart?.(clip, revision);
        playAtlas(atlas, 0, bridge.skipWakeEntry, sleep);
      });
    }

    void begin().catch(() => {
      if (!stopped) {
        delete element.dataset.ready;
        visible.current = undefined;
      }
    });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [clip, gentle, reduced, request, revision, skin]);

  return <canvas ref={canvas} className="pet-motion" />;
}
