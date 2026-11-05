import type { PetGains, PetState } from './contracts.ts';

export const chatCareTuning = {
  samplePerMessage: 1024,
  replyLengthCap: 2000,
  shortLength: 200,
  mediumLength: 1200,
  fullnessCosts: [1, 1.5, 2],
  timelyWindow: 5 * 60_000,
  timelyInterval: 10 * 60_000,
  timelyMood: .25,
  hintTurns: 20,
  hintInterval: 20 * 60_000,
  recovery: { fullness: 12, mood: 12, affection: 3 },
  effects: {
    neutral: { mood: -.5, affection: .5 },
    positive: { mood: 2, affection: 1 },
    scold: { mood: -2.5, affection: -.5 },
    insult: { mood: -4, affection: -1 },
  },
} as const;
export type ChatTone = keyof typeof chatCareTuning.effects;
export interface ChatPetEffect extends PetGains { tone: ChatTone; timely?: boolean }
export type CareReason = 'fullness' | 'mood' | 'affection';

export function careReason(pet: PetState): CareReason | undefined {
  if (pet.fullness <= 0) return 'fullness';
  if (pet.mood <= 0) return 'mood';
  if (pet.affection <= 0) return 'affection';
}

export function petName(value?: string): string {
  return value?.trim() || 'Dr. Meow';
}

export function normalizePetName(value: string): string {
  return [...value.normalize('NFKC').replace(/[\p{C}\p{Z}]+/gu, ' ').trim()].slice(0, 24).join('');
}

const words = {
  positive: ['谢谢', '多谢', '真棒', '好棒', '最棒', '真可爱', '好可爱', '喜欢', '爱你', '辛苦了',
    'thank you', 'thanks', 'great', 'adorable', 'cute', 'love', 'well done', 'good job'],
  scold: ['讨厌', '烦人', '坏猫', '笨猫', '不乖', 'hate', 'annoying', 'bad cat'],
  insult: ['废物', '蠢货', '白痴', '傻逼', '垃圾', '真蠢', '太蠢', '笨蛋', 'idiot', 'stupid', 'useless', 'moron', 'worthless'],
};
const discussion = /翻译|引用|转述|这句话|这个词|词语|台词|对白|讨论|解释|分析|举例|意思|有人说|别人|我家|现实中的|\b(?:translate|translation|quoted?|phrase|word|dialogue|discuss|explain|meaning|example|someone|character says)\b/i;
const taskFeedback = /代码|程序|答案|回答|结果|算错|不正确|算式|\b(?:code|program|answer|result|calculation|bug|incorrect)\b/i;
const negation = /不是|并不|不觉得|没有说|没说|不认为|并非|不讨厌|不烦人|\b(?:not|never|isn't|aren't|don't|doesn't|didn't)\b/i;

function boundedText(text: string): { text: string; uncertain: boolean } {
  const limit = chatCareTuning.samplePerMessage;
  const clipped = text.length > limit;
  const sample = clipped ? text.slice(0, limit / 2) + '\n' + text.slice(-limit / 2) : text;
  let fence = '';
  const lines: string[] = [];
  for (const line of sample.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = '';
      continue;
    }
    if (fence || /^\s*>/.test(line)) continue;
    lines.push(line);
  }
  const clean = lines.join('\n').toLocaleLowerCase()
    .replace(/`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g, ' ')
    .replace(/‘[^’]*’|(?:^|[\s[(])'[^'\n]+'(?=$|[\s)\],.!?])/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)|https?:\/\/[^\s]+|www\.[^\s]+/g, ' ');
  return { text: clean, uncertain: clipped || !!fence };
}

function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    const latin = /[a-z0-9]/.test(needle);
    if (!latin || (!/[a-z0-9]/.test(text[index - 1] ?? '') &&
      !/[a-z0-9]/.test(text[index + needle.length] ?? ''))) found.push(index);
    from = index + Math.max(1, needle.length);
  }
  return found;
}

export function classifyChat(user: string, reply: string, name: string): ChatTone {
  const sampledUser = boundedText(user);
  const sampledReply = boundedText(reply);
  if (sampledUser.uncertain || discussion.test(sampledUser.text)) return 'neutral';
  const aliases = [...new Set([petName(name).toLocaleLowerCase(), petName(name).toLocaleLowerCase().replace(/[。！？!?;]+$/g, ''), 'dr. meow', 'dr meow', '猫博士', '猫猫', '猫咪', '你', 'you'].filter(Boolean))];
  const found = new Set<ChatTone>();
  for (const clause of sampledUser.text.split(/[。！？!?;\n]/)) {
    if (negation.test(clause)) continue;
    const targets = aliases.flatMap(alias => occurrences(clause, alias));
    for (const tone of ['positive', 'scold', 'insult'] as const) {
      if (tone !== 'positive' && taskFeedback.test(clause)) continue;
      const matches = words[tone].flatMap(word => occurrences(clause, word));
      const directed = matches.some(index => targets.some(target => Math.abs(target - index) <= 28));
      const thanks = tone === 'positive' && /^(?:谢谢|多谢|辛苦了|thanks|thank you)(?:啦|了|哦|喵| so much| very much)?[，,.\s]*$/.test(clause.trim());
      const acknowledged = tone === 'positive' && matches.length > 0 && clause.trim().length <= 20 &&
        !sampledReply.uncertain && /不客气|谢谢|开心|thank|welcome|glad/.test(sampledReply.text);
      if (directed || thanks || acknowledged) found.add(tone);
    }
  }
  if (found.has('positive') && (found.has('scold') || found.has('insult'))) return 'neutral';
  if (found.has('insult')) return 'insult';
  if (found.has('scold')) return 'scold';
  return found.has('positive') ? 'positive' : 'neutral';
}

export function chatPetEffect(user: string, reply: string, name: string): ChatPetEffect {
  const length = user.length + Math.min(reply.length, chatCareTuning.replyLengthCap) * .5;
  const size = length <= chatCareTuning.shortLength ? 0 : length <= chatCareTuning.mediumLength ? 1 : 2;
  const tone = classifyChat(user, reply, name);
  return { tone, fullness: -chatCareTuning.fullnessCosts[size], ...chatCareTuning.effects[tone] };
}

