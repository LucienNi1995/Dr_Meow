import type { Animation, Food } from '../../shared/contracts.ts';

export interface PetFrame {
  animation: Animation;
  food?: Food;
  until?: number;
}

export const idleActivities = ['yarn', 'reading', 'math', 'experiment'] as const satisfies readonly Animation[];
export type IdleActivity = typeof idleActivities[number];

export function isIdleActivity(animation: Animation): animation is IdleActivity {
  return (idleActivities as readonly Animation[]).includes(animation);
}

export class IdleActivityRotation {
  private remaining: IdleActivity[] = [];
  private previous?: IdleActivity;

  next(random = Math.random): IdleActivity {
    if (!this.remaining.length) this.remaining = [...idleActivities];
    const candidates = this.remaining.filter(activity => activity !== this.previous);
    const choice = candidates[Math.floor(random() * candidates.length)];
    this.remaining.splice(this.remaining.indexOf(choice), 1);
    this.previous = choice;
    return choice;
  }
}

const effects = {
  yarn: { duration: 5000, priority: 0 },
  reading: { duration: 6000, priority: 0 },
  math: { duration: 6000, priority: 0 },
  experiment: { duration: 5500, priority: 0 },
  blink: { duration: 190, priority: 1 },
  tail: { duration: 1000, priority: 1 },
  stretch: { duration: 1450, priority: 1 },
  greet: { duration: 900, priority: 2 },
  farewell: { duration: 1050, priority: 2 },
  waking: { duration: 1050, priority: 2 },
  happy: { duration: 1200, priority: 3 },
  error: { duration: 1250, priority: 3 },
  petting: { duration: 1300, priority: 4 },
  eating: { duration: 1550, priority: 4 },
} satisfies Partial<Record<Animation, { duration: number; priority: number }>>;

type Effect = keyof typeof effects;
const assetLoadGrace = 1800;

export class AnimationStateMachine {
  private activity: 'idle' | 'thinking' | 'speaking' = 'idle';
  private asleep = false;
  private dragging = false;
  private effect?: { animation: Effect; food?: Food; until: number; manual?: boolean };

  constructor(private readonly authoredPlayback = false) {}

  private grace(): number {
    return this.authoredPlayback ? assetLoadGrace : 0;
  }

  finish(until: number, now: number): boolean {
    if (this.effect?.until !== until) return false;
    this.effect.until = now;
    this.frame(now);
    return true;
  }

  play(animation: Animation, now: number, food?: Food, manual = false): void {
    if (isIdleActivity(animation)) {
      if (!manual && this.frame(now).animation !== 'idle') return;
      if (manual) this.asleep = false;
    } else {
      this.cancelIdleActivity();
    }
    switch (animation) {
      case 'idle':
        this.activity = 'idle';
        this.asleep = false;
        this.effect = undefined;
        return;
      case 'sleeping':
        this.asleep = true;
        if (manual) this.activity = 'idle';
        this.effect = undefined;
        return;
      case 'thinking':
      case 'speaking':
        this.activity = animation;
        this.asleep = false;
        return;
      case 'dragging':
        this.dragging = true;
        return;
      case 'happy':
      case 'error':
        this.activity = 'idle';
        this.asleep = false;
        break;
      case 'farewell':
        if (this.asleep) return;
        break;
      case 'greet':
      case 'waking':
      case 'petting':
      case 'eating':
        this.asleep = false;
        break;
      default:
        break;
    }

    const effect = effects[animation];
    if (manual || !this.effect || this.effect.until <= now || effect.priority >= effects[this.effect.animation].priority) {
      this.effect = { animation, food, until: now + effect.duration + this.grace(), manual };
    }
  }

  setDragging(dragging: boolean): void {
    if (dragging && this.effect?.manual) this.effect = undefined;
    else if (dragging) this.cancelIdleActivity();
    this.dragging = dragging;
  }

  cancelIdleActivity(): boolean {
    if (!this.effect || this.effect.manual || !isIdleActivity(this.effect.animation)) return false;
    this.effect = undefined;
    return true;
  }

  frame(now: number): PetFrame {
    if (this.effect && this.effect.until <= now) {
      const happyUntil = this.effect.until + effects.happy.duration + this.grace();
      this.effect = this.effect.animation === 'eating' && happyUntil > now
        ? { animation: 'happy', until: happyUntil }
        : undefined;
    }
    if (this.dragging) return { animation: 'dragging' };
    if (this.effect && (this.effect.manual || effects[this.effect.animation].priority === 4)) {
      const { animation, until, food } = this.effect;
      return { animation, until, food };
    }
    if (this.activity !== 'idle') return { animation: this.activity };
    if (this.effect) {
      const { animation, until, food } = this.effect;
      return { animation, until, food };
    }
    return { animation: this.asleep ? 'sleeping' : 'idle' };
  }
}
