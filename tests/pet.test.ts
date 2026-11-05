import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyPetAction, LocalDatabase, petAtTime } from '../electron/database.ts';
import { AnimationStateMachine, IdleActivityRotation, idleActivities } from '../src/pet/AnimationStateMachine.ts';
import { classifyGesture, hitAlpha, hoverIntent, isDoubleClick, isHead, MASK_SIZE, trackMovement } from '../src/pet/gestures.ts';
import type { Gesture } from '../src/pet/gestures.ts';

const initial = { fullness: 78, affection: 10, lastInteractionAt: 0 };

test('petting, feeding, rest, and wake build affection while food increases fullness', () => {
  const petted = applyPetAction(initial, { type: 'pet' }, 0);
  assert.deepEqual(petted, { ...initial, affection: 12 });
  const fed = applyPetAction(petted, { type: 'feed', food: 'fish' }, 0);
  assert.equal(fed.fullness, 91);
  assert.equal(fed.affection, 14);
  assert.equal(applyPetAction(fed, { type: 'feed', food: 'can' }, 0).fullness, 100);
  assert.equal(applyPetAction({ ...initial, affection: 99 }, { type: 'pet' }, 0).affection, 100);
  assert.equal(applyPetAction(initial, { type: 'sleep' }, 0).affection, 11);
  assert.equal(applyPetAction(initial, { type: 'wake' }, 0).affection, 11);
  assert.equal(petAtTime(initial, 3_600_000).fullness, 77.3);
});

test('pet state and position survive a database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dr-meow-pet-'));
  const path = join(directory, 'meow.sqlite');
  const expectedPet = applyPetAction(initial, { type: 'feed', food: 'treat' }, 30_000);
  let db = new LocalDatabase(path);
  try {
    db.savePet(expectedPet);
    db.savePosition({ x: -530, y: 91 });
    db.close();
    db = new LocalDatabase(path);
    assert.deepEqual(db.pet(), expectedPet);
    assert.deepEqual(db.position(), { x: -530, y: 91 });
  } finally {
    db.close();
    for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test('short head strokes pet the cat while long moves commit to dragging', () => {
  const gesture: Gesture = { origin: { x: 120, y: 160 }, head: true, size: 180, distance: 0 };
  assert.equal(classifyGesture(gesture), 'click');
  assert.equal(trackMovement(gesture, { x: 132, y: 160 }), false);
  assert.equal(classifyGesture(gesture), 'pet');
  assert.equal(trackMovement(gesture, { x: 147, y: 160 }), true);
  trackMovement(gesture, gesture.origin);
  assert.equal(classifyGesture(gesture), 'drag');
  assert.equal(classifyGesture({ ...gesture, distance: 15, head: false }), 'drag');
  assert.equal(classifyGesture({ ...gesture, distance: 35, size: 360 }), 'pet');
  assert.ok(isHead({ x: 0.45, y: 0.39 }));
  assert.equal(isHead({ x: 0.45, y: 0.79 }), false);
});

test('two short clicks must be close in time and position', () => {
  const first = { x: 120, y: 160, time: 10 };
  assert.ok(isDoubleClick(first, { x: 122, y: 161, time: 300 }));
  assert.equal(isDoubleClick(first, { x: 131, y: 160, time: 120 }), false);
  assert.equal(isDoubleClick(first, { x: 120, y: 160, time: 430 }), false);
});

test('only the head opens the status card and the card itself keeps it visible', () => {
  assert.equal(hoverIntent(false, false, false), undefined);
  assert.equal(hoverIntent(false, false, true), undefined);
  assert.equal(hoverIntent(false, true, false), 'show');
  assert.equal(hoverIntent(true, true, false), undefined);
  assert.equal(hoverIntent(true, false, true), undefined);
  assert.equal(hoverIntent(true, false, false), 'hide');
});

test('transparent pixels and positions outside the portrait never intercept pointer input', () => {
  const mask = new Uint8ClampedArray(MASK_SIZE * MASK_SIZE * 4);
  mask[(90 * MASK_SIZE + 90) * 4 + 3] = 255;
  assert.ok(hitAlpha(mask, { x: 0.5, y: 0.5 }));
  assert.equal(hitAlpha(mask, { x: 0.1, y: 0.1 }), false);
  assert.equal(hitAlpha(mask, { x: 1, y: 0.5 }), false);
  assert.equal(hitAlpha(mask, { x: -0.01, y: 0.5 }), false);
});

test('animation state machine resumes active chat after drag and feed', () => {
  const cat = new AnimationStateMachine();
  assert.equal(cat.frame(0).animation, 'idle');
  cat.play('thinking', 20);
  cat.play('blink', 30);
  assert.equal(cat.frame(30).animation, 'thinking');
  cat.setDragging(true);
  cat.play('speaking', 60);
  assert.equal(cat.frame(60).animation, 'dragging');
  cat.setDragging(false);
  cat.play('eating', 70, 'treat');
  assert.deepEqual(cat.frame(70), { animation: 'eating', until: 1620, food: 'treat' });
  assert.equal(cat.frame(1700).animation, 'speaking');
  cat.play('happy', 1750);
  assert.equal(cat.frame(1760).animation, 'happy');
  assert.equal(cat.frame(3000).animation, 'idle');
});

test('sleep, wake, feed, and the Happy follow-through have bounded transitions', () => {
  const cat = new AnimationStateMachine();
  cat.play('sleeping', 0);
  assert.equal(cat.frame(99).animation, 'sleeping');
  cat.play('waking', 100);
  assert.equal(cat.frame(100).animation, 'waking');
  assert.equal(cat.frame(1200).animation, 'idle');
  cat.play('eating', 1210, 'fish');
  assert.equal(cat.frame(2760).animation, 'happy');
  assert.equal(cat.frame(3970).animation, 'idle');
});

test('autonomous activities rotate through all four choices before repeating', () => {
  const rotation = new IdleActivityRotation();
  const firstRound = idleActivities.map(() => rotation.next(() => .999));
  assert.deepEqual(new Set(firstRound), new Set(idleActivities));
  const firstOfNextRound = rotation.next(() => 0);
  assert.notEqual(firstOfNextRound, firstRound.at(-1));
});

test('autonomous poses have bounded durations and yield to chat, drag, or direct interaction', () => {
  for (const activity of idleActivities) {
    const cat = new AnimationStateMachine();
    cat.play(activity, 100);
    const initialFrame = cat.frame(100);
    assert.equal(initialFrame.animation, activity);
    assert.ok(initialFrame.until && initialFrame.until > 100);
    assert.equal(cat.frame(initialFrame.until).animation, 'idle');

    cat.play(activity, 6101);
    cat.play('thinking', 6400);
    assert.equal(cat.frame(6500).animation, 'thinking');
    cat.play('happy', 6700);
    cat.play(activity, 6800);
    assert.equal(cat.frame(6900).animation, 'happy');
    assert.equal(cat.frame(8100).animation, 'idle');

    cat.play(activity, 8200);
    cat.setDragging(true);
    assert.equal(cat.frame(8300).animation, 'dragging');
    cat.setDragging(false);
    assert.equal(cat.frame(8400).animation, 'idle');
    cat.play(activity, 8500);
    assert.equal(cat.cancelIdleActivity(), true);
    assert.equal(cat.frame(8600).animation, 'idle');
    assert.equal(cat.cancelIdleActivity(), false);
  }
});
