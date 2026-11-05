import type { Animation, Food, PetState } from './contracts.ts';

export const hour = 3_600_000;
export const careTuning = {
  neutralMood: 56,
  fullnessPerHour: 5,
  moodPerHour: 1,
  maxOfflineHours: 8,
  stateInterval: 30_000,
  affectionInterval: 5 * 60_000,
  minimumRest: 2 * 60_000,
  feeding: {
    fish: { fullness: 8, mood: 2, affection: .5 },
    can: { fullness: 14, mood: 3, affection: 1 },
    treat: { fullness: 5, mood: 4, affection: .75 },
  } satisfies Record<Food, { fullness: number; mood: number; affection: number }>,
  gains: {
    pet: { mood: 6, affection: 1 },
    play: { mood: 10, affection: 1 },
    rest: { mood: 8, affection: .5 },
  },
};

export const careContacts = {
  petting: { duration: 1300, progress: 460 / 1300 },
  eating: { duration: 1550, progress: .44 },
  yarn: { duration: 5000, progress: .38 },
  sleeping: { duration: 1150, progress: .9 },
  waking: { duration: 1050, progress: .8 },
} satisfies Partial<Record<Animation, { duration: number; progress: number }>>;

export type Mood = 'calm' | 'content' | 'happy' | 'curious';

export function moodFor(pet: PetState, previous?: Mood): Mood {
  if (previous === 'happy' ? pet.mood >= 70 : pet.mood >= 75) return 'happy';
  if (previous === 'curious' ? pet.fullness <= 44 || pet.mood <= 49 : pet.fullness <= 39 || pet.mood <= 45) return 'curious';
  if (previous === 'content' ? pet.mood >= 59 : pet.mood >= 64) return 'content';
  return 'calm';
}

export function displayedStat(value: number): number {
  return value > 0 ? Math.max(.1, Math.round(Math.min(100, value) * 10) / 10) : 0;
}

