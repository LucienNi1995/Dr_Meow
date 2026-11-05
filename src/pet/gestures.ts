import type { Point } from '../../shared/contracts.ts';

export interface Gesture {
  origin: Point;
  head: boolean;
  size: number;
  distance: number;
}

export const DOUBLE_CLICK_MS = 410;
export const HOVER_OPEN_MS = 400;
export const HOVER_CLOSE_MS = 575;

export function hoverIntent(visible: boolean, onHead: boolean, onCard: boolean): 'show' | 'hide' | undefined {
  if (visible) return onHead || onCard ? undefined : 'hide';
  return onHead ? 'show' : undefined;
}

export function trackMovement(gesture: Gesture, point: Point): boolean {
  const travelled = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y);
  gesture.distance = Math.max(travelled, gesture.distance);
  return classifyGesture(gesture) === 'drag';
}

export function classifyGesture(gesture: Gesture): 'drag' | 'pet' | 'click' {
  if (gesture.distance >= (gesture.head ? 24 * gesture.size / 180 : 6)) return 'drag';
  if (gesture.head && gesture.distance >= 5) return 'pet';
  return 'click';
}

export function isDoubleClick(previous: Point & { time: number }, current: Point & { time: number }): boolean {
  return current.time - previous.time <= DOUBLE_CLICK_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= 9;
}

export function isHead(point: Point): boolean {
  return point.x >= 0.18 && point.x <= 0.83 && point.y >= 0.18 && point.y <= 0.59;
}

export const MASK_SIZE = 180;

export function hitAlpha(mask: Uint8ClampedArray, normalized: Point): boolean {
  if (normalized.x < 0 || normalized.x >= 1 || normalized.y < 0 || normalized.y >= 1) return false;
  const x = Math.floor(normalized.x * MASK_SIZE);
  const y = Math.floor(normalized.y * MASK_SIZE);
  return mask[(y * MASK_SIZE + x) * 4 + 3] >= 24;
}
