import type { Point, SkinId } from '../../shared/contracts.ts';
import { posterUrl } from './frameAssets.ts';
import artwork from './generatedFrames.json';

export function skinPortrait(skin: SkinId): string {
  return posterUrl(skin);
}

export function skinHead(skin: SkinId, point: Point): boolean {
  const [x, y, rx, ry] = artwork[skin].idle.head;
  return ((point.x - x) / rx) ** 2 + ((point.y - y) / ry) ** 2 <= 1;
}

