import { randomUUID } from 'node:crypto';
import { validPrice, type ModelPrice, type UsageData, type UsageRecord, type UsageScan } from '../shared/usage.ts';
import { DatabaseSync } from 'node:sqlite';
import { translate } from '../shared/i18n.ts';
import { careTuning, hour } from '../shared/petCare.ts';
import { careReason, chatCareTuning, chatPetEffect, normalizePetName } from '../shared/chatCare.ts';
import { petViewport } from './geometry.ts';
import { skinIds } from '../shared/contracts.ts';
import type { Conversation, Message, PetAction, PetState, Point, Settings } from '../shared/contracts.ts';

export const defaultSettings: Settings = {
  locale: 'zh-CN', petName: 'Dr. Meow', skin: 'original', size: 180, alwaysOnTop: true, positionLocked: false,
  avoidFullscreen: true, startOnLogin: false, opacity: 1, animation: 'full',
  quiet: false, tone: 'normal', length: 'standard', model: ''
};
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
type RewardKind = 'feed' | keyof typeof careTuning.gains;
type StoredPet = PetState & {
  lastRewards?: Partial<Record<RewardKind, number>>;
  lastAffectionRewards?: Partial<Record<RewardKind, number>>;
  lastReplyAt?: number;
  lastTimelyRewardAt?: number;
  turnsSinceCare?: number;
  lastCareHintAt?: number;
};
type OlderPet = Omit<StoredPet, 'mood'> & { mood?: number };
const newPet = (): StoredPet => ({
  fullness: 78, mood: careTuning.neutralMood, affection: 10, lastInteractionAt: Date.now()
});

export function petAtTime(state: OlderPet, now = Date.now()): StoredPet {
  const hours = Math.min(careTuning.maxOfflineHours, Math.max(0, (now - state.lastInteractionAt) / hour));
  const target = careTuning.neutralMood;
  const mood = state.mood ?? careTuning.neutralMood;
  const pace = careTuning.moodPerHour;
  return {
    ...state,
    fullness: clamp(state.fullness - hours * careTuning.fullnessPerHour),
    mood: mood <= 0 ? 0 : clamp(mood + Math.sign(target - mood) * Math.min(Math.abs(target - mood), hours * pace)),
    affection: clamp(state.affection),
  };
}

function updateClock(state: OlderPet, now: number): StoredPet {
  return { ...petAtTime(state, now), lastInteractionAt: Math.max(state.lastInteractionAt, now) };
}

function caredFor(state: StoredPet): StoredPet {
  return { ...state, turnsSinceCare: 0, careHintAt: undefined };
}

export function applyPetAction(state: OlderPet, action: PetAction, now = Date.now()): StoredPet {
  const next = updateClock(state, now);
  if (action.type === 'sleep') return { ...next, restingSince: next.restingSince ?? now };
  if (action.type === 'wake') {
    delete next.restingSince;
    if (state.restingSince === undefined || now - state.restingSince < careTuning.minimumRest) return next;
  }
  const kind = action.type === 'wake' ? 'rest' : action.type;
  const gain = action.type === 'feed' ? careTuning.feeding[action.food]
    : careTuning.gains[action.type === 'wake' ? 'rest' : action.type];
  const before = { ...next };
  const lastState = state.lastRewards?.[kind];
  const lastAffection = state.lastAffectionRewards?.[kind];
  if (lastState === undefined || now - lastState >= careTuning.stateInterval) {
    if (action.type === 'feed') next.fullness = clamp(next.fullness + careTuning.feeding[action.food].fullness);
    next.mood = clamp(next.mood + gain.mood);
    if (next.fullness !== before.fullness || next.mood !== before.mood) {
      next.lastRewards = { ...state.lastRewards, [kind]: now };
    }
  }
  if (lastAffection === undefined || now - lastAffection >= careTuning.affectionInterval) {
    next.affection = clamp(next.affection + gain.affection);
    if (next.affection !== before.affection) next.lastAffectionRewards = { ...state.lastAffectionRewards, [kind]: now };
  }
  return next.fullness > before.fullness || next.mood > before.mood || next.affection > before.affection
    ? caredFor(next) : next;
}

export function sanitizeSettings(patch: Partial<Settings>, current: Settings): Settings {
  const next = { ...current };
  if (patch.locale === 'zh-CN' || patch.locale === 'en') next.locale = patch.locale;
  if (typeof patch.petName === 'string') next.petName = normalizePetName(patch.petName) || 'Dr. Meow';
  if (patch.skin && skinIds.includes(patch.skin)) next.skin = patch.skin;
  if (typeof patch.size === 'number' && Number.isFinite(patch.size)) next.size = Math.round(clamp(patch.size, 180, 360));
  if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) next.opacity = clamp(patch.opacity, 0.35, 1);
  for (const key of ['alwaysOnTop', 'positionLocked', 'avoidFullscreen', 'startOnLogin', 'quiet'] as const) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  if (patch.animation === 'full' || patch.animation === 'gentle') next.animation = patch.animation;
  if (patch.tone === 'normal' || patch.tone === 'cute' || patch.tone === 'professional') next.tone = patch.tone;
  if (patch.length === 'short' || patch.length === 'standard' || patch.length === 'detailed') next.length = patch.length;
  if (typeof patch.model === 'string' && patch.model.length <= 180) next.model = patch.model;
  return next;
}

type ChatRow = { id: string; title: string; updated_at: number };
type MessageRow = { content: string };

export class LocalDatabase {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_values (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
      CREATE TABLE IF NOT EXISTS bonded_turns (
        user_message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
    this.migrate();
    this.db.exec("UPDATE usage_records SET content=json_set(content, '$.status', 'cancelled') WHERE json_extract(content, '$.status')='running'");
    for (const row of this.db.prepare("SELECT id, content FROM messages WHERE json_extract(content, '$.status')='streaming'").all()) {
      const message = JSON.parse(String(row.content)) as Message;
      this.db.prepare('UPDATE messages SET content=? WHERE id=?')
        .run(JSON.stringify({ ...message, status: 'cancelled' }), String(row.id));
    }
  }

  private migrate() {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (version >= 4) return;
    this.db.exec('BEGIN');
    try {
      const position = this.position();
      if (version === 0 && position) {
        const { size } = this.settings();
        const heightAdded = petViewport(size).height - Math.max(size, 280);
        this.savePosition({ x: position.x, y: position.y - heightAdded });
      }
      this.db.exec('ALTER TABLE bonded_turns ADD COLUMN effect TEXT');
      const pet = this.read<(OlderPet & { hunger?: number }) | null>('pet', null);
      if (pet) {
        const { hunger, ...saved } = pet;
        this.savePet({
          ...saved,
          fullness: Number.isFinite(hunger) ? clamp(100 - hunger!) : saved.fullness,
          mood: saved.mood ?? careTuning.neutralMood,
          lastInteractionAt: Date.now(),
          lastAffectionRewards: saved.lastAffectionRewards ?? saved.lastRewards,
          turnsSinceCare: saved.turnsSinceCare ?? 0,
        });
      }
      this.db.exec('PRAGMA user_version=4; COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private read<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM local_values WHERE key=?').get(key);
    return row ? JSON.parse(String(row.value)) as T : fallback;
  }

  private write(key: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO local_values(key,value) VALUES (?,?)').run(key, JSON.stringify(value));
  }

  settings(): Settings { return sanitizeSettings(this.read('settings', {}), defaultSettings); }
  saveSettings(value: Settings) { this.write('settings', value); }
  pet(): StoredPet {
    const saved = this.read<StoredPet | null>('pet', null);
    if (saved) return saved;
    const pet = newPet();
    this.savePet(pet);
    return pet;
  }
  savePet(pet: StoredPet) { this.write('pet', pet); }
  currentPet(now = Date.now()): StoredPet {
    const next = updateClock(this.pet(), now);
    this.savePet(next);
    return next;
  }
  recoverPet(now = Date.now()): StoredPet {
    const next = updateClock(this.pet(), now);
    if (careReason(next)) {
      for (const key of ['fullness', 'mood', 'affection'] as const) {
        next[key] = Math.max(next[key], chatCareTuning.recovery[key]);
      }
      delete next.restingSince;
      Object.assign(next, caredFor(next));
    }
    this.savePet(next);
    return next;
  }
  resetPet() { this.savePet(newPet()); }
  endPetRest(now = Date.now()): StoredPet | undefined {
    const pet = this.pet();
    if (pet.restingSince === undefined) return undefined;
    const next = updateClock(pet, now);
    delete next.restingSince;
    this.savePet(next);
    return next;
  }
  position(): Point | null { return this.read('position', null); }
  savePosition(point: Point) { this.write('position', point); }

  private assemble(row: ChatRow): Conversation {
    const messages = this.db.prepare('SELECT content FROM messages WHERE conversation_id=? ORDER BY rowid')
      .all(row.id) as MessageRow[];
    return {
      id: row.id, title: row.title, updatedAt: row.updated_at,
      messages: messages.map(message => JSON.parse(message.content) as Message)
    };
  }

  chats(): Conversation[] {
    const rows = this.db.prepare('SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC, rowid DESC')
      .all() as ChatRow[];
    return rows.map(row => this.assemble(row));
  }

  chat(id: string): Conversation | undefined {
    const row = this.db.prepare('SELECT id, title, updated_at FROM conversations WHERE id=?').get(id) as ChatRow | undefined;
    return row && this.assemble(row);
  }

  createChat(): Conversation {
    const chat = { id: randomUUID(), title: translate(this.settings().locale, '新对话', 'New chat'), updatedAt: Date.now(), messages: [] };
    this.db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(chat.id, chat.title, chat.updatedAt);
    return chat;
  }

  rename(id: string, title: string) {
    this.db.prepare('UPDATE conversations SET title=? WHERE id=?').run(title, id);
  }

  remove(id: string) { this.db.prepare('DELETE FROM conversations WHERE id=?').run(id); }
  clearChats() {
    this.db.exec('DELETE FROM conversations; PRAGMA wal_checkpoint(TRUNCATE);');
  }
  clearAll() {
    this.db.exec('BEGIN; DELETE FROM conversations; DELETE FROM usage_records; DELETE FROM local_values; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
  }

  recordUsage(value: UsageRecord) {
    if (value.at <= this.read<number>('usageClearedAt', 0)) return;
    this.db.prepare('INSERT OR REPLACE INTO usage_records(id,content) VALUES (?,?)').run(value.id, JSON.stringify(value));
  }

  importUsage(records: UsageRecord[]) {
    this.db.exec('BEGIN');
    try { for (const row of records) this.recordUsage(row); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  usageScan(): UsageScan {
    return this.read('usageScan', { enabled: false, files: 0, imported: 0, skipped: 0, malformed: 0, unavailable: 0 });
  }
  saveUsageScan(scan: UsageScan) { this.write('usageScan', scan); }

  usage(): UsageData {
    const records = this.db.prepare('SELECT content FROM usage_records').all()
      .map(row => JSON.parse(String(row.content)) as UsageRecord).sort((a, b) => b.at - a.at);
    return { records, prices: this.read<ModelPrice[]>('usagePrices', []).filter(validPrice), scan: this.usageScan() };
  }

  setUsagePrice(value: ModelPrice) {
    if (!validPrice(value)) throw new Error('Invalid model price');
    const prices = this.read<ModelPrice[]>('usagePrices', []).filter(price => validPrice(price) && price.model !== value.model);
    prices.push({ model: value.model, input: value.input, output: value.output, cached: value.cached, cacheWrite: value.cacheWrite });
    this.write('usagePrices', prices);
  }

  clearUsage() {
    this.db.exec('DELETE FROM usage_records; PRAGMA wal_checkpoint(TRUNCATE);');
    this.write('usageClearedAt', Date.now());
    this.saveUsageScan({ ...this.usageScan(), enabled: false });
  }

  startTurn(id: string, user: Message, assistant: Message, retryId?: string) {
    this.db.exec('BEGIN');
    try {
      if (retryId) this.db.prepare('DELETE FROM messages WHERE conversation_id=? AND id=?').run(id, retryId);
      const insert = this.db.prepare('INSERT INTO messages VALUES (?,?,?)');
      if (!retryId) insert.run(user.id, id, JSON.stringify(user));
      insert.run(assistant.id, id, JSON.stringify(assistant));
      this.db.prepare("UPDATE conversations SET updated_at=?, title=CASE WHEN title IN ('新对话','New chat') THEN ? ELSE title END WHERE id=?")
        .run(Date.now(), [...user.text.replace(/\s+/g, ' ')].slice(0, 38).join(''), id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateMessage(message: Message) {
    this.db.prepare('UPDATE messages SET content=? WHERE id=?').run(JSON.stringify(message), message.id);
  }

  completeChatReply(userMessageId: string, reply: Message, now = Date.now(), name = this.settings().petName): PetState | undefined {
    this.db.exec('BEGIN');
    try {
      const settled = this.db.prepare('SELECT effect FROM bonded_turns WHERE user_message_id=?').get(userMessageId);
      reply.completedAt = now;
      if (settled) {
        if (settled.effect) reply.petEffect = JSON.parse(String(settled.effect));
        this.updateMessage(reply);
        this.db.exec('COMMIT');
        return undefined;
      }
      const row = this.db.prepare("SELECT content FROM messages WHERE id=? AND json_extract(content,'$.role')='user'").get(userMessageId);
      if (!row) throw new Error('Missing user message for pet settlement');
      const user = JSON.parse(String(row.content)) as Message;
      const next = updateClock(this.pet(), now);
      const effect = chatPetEffect(user.text, reply.text, name);
      const elapsed = next.lastReplyAt === undefined ? Infinity : user.createdAt - next.lastReplyAt;
      const sinceReward = next.lastTimelyRewardAt === undefined ? Infinity : user.createdAt - next.lastTimelyRewardAt;
      if (elapsed >= 0 && elapsed <= chatCareTuning.timelyWindow && sinceReward >= chatCareTuning.timelyInterval) {
        effect.mood = (effect.mood ?? 0) + chatCareTuning.timelyMood;
        effect.timely = true;
        next.lastTimelyRewardAt = user.createdAt;
      }
      for (const key of ['fullness', 'mood', 'affection'] as const) {
        const before = next[key];
        next[key] = clamp(before + (effect[key] ?? 0));
        effect[key] = Math.round((next[key] - before) * 100) / 100;
      }
      next.lastReplyAt = now;
      next.turnsSinceCare = (next.turnsSinceCare ?? 0) + 1;
      if (next.turnsSinceCare >= chatCareTuning.hintTurns &&
          now - (next.lastCareHintAt ?? -Infinity) >= chatCareTuning.hintInterval) {
        next.lastCareHintAt = next.careHintAt = now;
      }
      reply.petEffect = effect;
      this.updateMessage(reply);
      this.db.prepare('INSERT INTO bonded_turns(user_message_id,effect) VALUES (?,?)').run(userMessageId, JSON.stringify(effect));
      this.savePet(next);
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }
}

