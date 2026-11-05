import type { Point } from '../shared/contracts.ts';

export interface Rect extends Point { width: number; height: number }
const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function petViewport(size: number) {
  return { width: Math.max(size, 248), height: size + 130 };
}

export function keepVisible(bounds: Rect, area: Rect): Point {
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - bounds.width),
    y: clamp(bounds.y, area.y, area.y + area.height - bounds.height)
  };
}

export function besidePet(pet: Rect, panel: Rect, area: Rect): Point {
  const gap = 14;
  const right = pet.x + pet.width + gap;
  return keepVisible({
    ...panel,
    x: right + panel.width <= area.x + area.width ? right : pet.x - panel.width - gap,
    y: pet.y + pet.height - panel.height
  }, area);
}

