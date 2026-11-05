import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LocalDatabase, defaultSettings, sanitizeSettings } from '../electron/database.ts';
import { besidePet, keepVisible, petViewport } from '../electron/geometry.ts';
import type { Message, Settings } from '../shared/contracts.ts';

test('conversation, interruption recovery, retry and deletion survive reopening SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dr-meow-storage-'));
  const path = join(directory, 'data.sqlite');
  let db = new LocalDatabase(path);
  try {
    const chat = db.createChat();
    const user: Message = { id: 'user', text: '天空为什么是蓝的？', role: 'user', createdAt: 1 };
    const assistant: Message = { id: 'assistant', text: '', role: 'assistant', createdAt: 2, status: 'streaming' };
    db.startTurn(chat.id, user, assistant);
    db.rename(chat.id, '天空');
    db.close();
    db = new LocalDatabase(path);
    assert.equal(db.chat(chat.id)?.title, '天空');
    assert.equal(db.chat(chat.id)?.messages[1].status, 'cancelled');
    const retry: Message = { ...assistant, id: 'retry', text: '瑞利散射。', status: 'complete' };
    db.startTurn(chat.id, user, retry, assistant.id);
    assert.deepEqual(db.chat(chat.id)?.messages, [user, retry]);
    db.clearChats();
    assert.deepEqual(db.chats(), []);
    assert.equal(db.chat(chat.id), undefined);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('settings reject invalid numeric values and keep the requested scale range', () => {
  const result = sanitizeSettings({ size: 1000, opacity: Number.NaN, alwaysOnTop: false }, defaultSettings);
  assert.equal(result.size, 360);
  assert.equal(result.opacity, 1);
  assert.equal(result.alwaysOnTop, false);
  assert.equal(defaultSettings.size, 180);
});

test('settings persist the selected language and coat across restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dr-meow-settings-'));
  const path = join(directory, 'data.sqlite');
  let db: LocalDatabase | undefined;
  try {
    db = new LocalDatabase(path);
    const selected = sanitizeSettings({ locale: 'en', skin: 'calico' }, db.settings());
    db.saveSettings(selected);
    db.close();
    db = undefined;

    db = new LocalDatabase(path);
    assert.deepEqual(db.settings(), { ...defaultSettings, locale: 'en', skin: 'calico' });
    assert.equal(db.createChat().title, 'New chat');
    const invalid = { locale: 'fr', skin: 'unknown' } as unknown as Partial<Settings>;
    assert.deepEqual(sanitizeSettings(invalid, db.settings()), selected);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrades 0.1 and 0.2 pet states while preserving the pet window bottom edge', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dr-meow-legacy-'));
  try {
    for (const { version, size, previousHeight } of [
      { version: 0, size: 180, previousHeight: 280 },
      { version: 0, size: 360, previousHeight: 360 },
      { version: 1, size: 180, previousHeight: 310 },
    ]) {
      const path = join(directory, version + '-' + size + '.sqlite');
      const position = { x: -540, y: 300 };
      const pet = { hunger: 44, happiness: 82, energy: 77, affection: 36, lastInteractionAt: 1 };
      const legacy = new DatabaseSync(path);
      try {
        legacy.exec('CREATE TABLE local_values (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        if (version === 1) legacy.exec('PRAGMA user_version=1');
        const insert = legacy.prepare('INSERT INTO local_values VALUES (?, ?)');
        insert.run('settings', JSON.stringify({
          size, alwaysOnTop: false, startOnLogin: true, opacity: 0.8, animation: 'gentle',
          quiet: true, tone: 'professional', length: 'detailed', model: 'saved-model',
        }));
        insert.run('position', JSON.stringify(position));
        insert.run('pet', JSON.stringify(pet));
      } finally {
        legacy.close();
      }

      const expected = { x: position.x, y: position.y + previousHeight - (size + 130) };
      for (let restart = 0; restart < 2; restart++) {
        const db = new LocalDatabase(path);
        try {
          assert.deepEqual(db.position(), expected);
          assert.deepEqual(db.pet(), { fullness: 56, affection: pet.affection, lastInteractionAt: pet.lastInteractionAt });
          assert.deepEqual(db.settings(), {
            locale: 'zh-CN', skin: 'original', size, alwaysOnTop: false, avoidFullscreen: true, startOnLogin: true,
            opacity: 0.8, animation: 'gentle', quiet: true, tone: 'professional',
            length: 'detailed', model: 'saved-model',
          });
        } finally {
          db.close();
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chat affection is awarded once across successful reply retries and a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dr-meow-bond-'));
  const path = join(directory, 'data.sqlite');
  let db: LocalDatabase | undefined;
  try {
    db = new LocalDatabase(path);
    const baseline = db.pet();
    const chat = db.createChat();
    const user: Message = { id: 'bond-user', text: 'Hello', role: 'user', createdAt: 1 };
    const assistant: Message = { id: 'bond-reply', text: '', role: 'assistant', createdAt: 2, status: 'streaming' };
    db.startTurn(chat.id, user, assistant);
    db.updateMessage({ ...assistant, status: 'error' });
    assert.equal(db.pet().affection, baseline.affection);
    const reply = { ...assistant, text: 'Hi!', status: 'complete' as const };
    assert.equal(db.completeChatReply(user.id, reply)?.affection, baseline.affection + 1);
    db.close();
    db = undefined;

    db = new LocalDatabase(path);
    const retry = { ...reply, id: 'bond-retry' };
    db.startTurn(chat.id, user, { ...retry, status: 'streaming' }, reply.id);
    assert.equal(db.completeChatReply(user.id, retry), undefined);
    assert.equal(db.pet().affection, baseline.affection + 1);
    assert.equal(db.chat(chat.id)?.messages.at(-1)?.text, 'Hi!');
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('window placement uses the monitor work area including negative coordinates', () => {
  const area = { x: -1600, y: -100, width: 1600, height: 1000 };
  const bounds = { x: -240, y: 800, ...petViewport(180) };
  assert.deepEqual(keepVisible(bounds, area), { x: -248, y: 590 });
  const pet = { ...bounds, x: -248, y: 590 };
  const panel = { x: 0, y: 0, width: 390, height: 480 };
  assert.deepEqual(besidePet(pet, panel, area), { x: -652, y: 420 });
});

