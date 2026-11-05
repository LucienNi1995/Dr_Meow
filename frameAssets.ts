import type { SkinId } from '../../shared/contracts.ts';
import source from './generatedFrames.json';

export type ClipName =
  'idle' | 'idle-content' | 'idle-happy' | 'idle-curious' | 'blink' | 'happy' |
  'petting-left' | 'petting-right' | 'eating-fish' | 'eating-can' | 'eating-treat' |
  'thinking' | 'speaking' | 'sleeping' | 'sleeping-loop' | 'waking' | 'dragging' | 'drag-end' |
  'error' | 'greet' | 'farewell' | 'stretch' | 'tail' | 'yarn' | 'reading' | 'math' | 'experiment';

interface Frames {
  width: number;
  height: number;
  columns: number;
  holds: number[];
  contactFrame?: number;
  loopFrom?: number;
  safeFrames?: number[];
}

interface Timeline extends Frames {
  starts: number[];
  duration: number;
}

export interface FrameAtlas {
  clip: ClipName;
  skin: SkinId;
  image: HTMLImageElement;
  timeline: Timeline;
}

const frames: Record<SkinId, Record<ClipName, Frames>> = source;
const atlasCache = new Map<string, Promise<FrameAtlas>>();

export function posterUrl(skin: SkinId): string {
  return import.meta.env.BASE_URL + 'pet/v1/' + skin + '/poster.webp';
}

export function clipDuration(skin: SkinId, clip: ClipName): number {
  return frames[skin][clip].holds.reduce((total, hold) => total + hold, 0);
}

export function loadFrameAtlas(skin: SkinId, clip: ClipName): Promise<FrameAtlas> {
  const key = skin + '/' + clip;
  const cached = atlasCache.get(key);
  if (cached) {
    atlasCache.delete(key);
    atlasCache.set(key, cached);
    return cached;
  }

  const data = frames[skin][clip];
  let duration = 0;
  const starts = data.holds.map(hold => {
    const start = duration;
    duration += hold;
    return start;
  });
  const image = new Image();
  image.src = import.meta.env.BASE_URL + 'pet/v1/' + key + '.webp';
  const pending = image.decode().then(() => ({ clip, skin, image, timeline: { ...data, starts, duration } }));
  atlasCache.set(key, pending);
  void pending.catch(() => {
    if (atlasCache.get(key) === pending) atlasCache.delete(key);
  });
  if (atlasCache.size > 14) {
    const oldest = atlasCache.keys().next().value;
    if (oldest) atlasCache.delete(oldest);
  }
  return pending;
}
