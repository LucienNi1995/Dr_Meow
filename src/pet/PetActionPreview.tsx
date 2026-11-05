import { useEffect, useId, useRef, useState } from 'react';
import type { Food, SkinId } from '../../shared/contracts.ts';
import type { translator } from '../../shared/i18n.ts';
import type { Mood } from '../../shared/petCare.ts';
import type { PetFrame } from './AnimationStateMachine.ts';
import { PetIcon } from './PetIcon.tsx';
import { PetScene } from './PetScene.tsx';
import { clipDuration, type ClipName } from './frameAssets.ts';

interface Cue extends PetFrame {
  mood?: Mood;
  direction?: number;
  hold?: number;
}

interface PreviewAction {
  key: string;
  name: [string, string];
  cues: readonly Cue[];
}

const single = (animation: Cue['animation'], zh: string, en: string, hold?: number): PreviewAction => (
  { key: animation, name: [zh, en], cues: [{ animation, hold }] }
);

const moods = [
  ['calm', '静坐 · 安静', 'Sit · Calm'], ['content', '静坐 · 满足', 'Sit · Content'],
  ['happy', '静坐 · 开心', 'Sit · Happy'], ['curious', '静坐 · 想玩', 'Sit · Playful'],
] as const satisfies readonly (readonly [Mood, string, string])[];

const foods = [
  ['fish', '吃小鱼干', 'Eat dried fish'], ['can', '吃罐头', 'Eat wet food'], ['treat', '吃猫条', 'Eat a lickable treat'],
] as const satisfies readonly (readonly [Food, string, string])[];

const categories: { label: [string, string]; actions: PreviewAction[] }[] = [
  { label: ['日常姿态', 'Daily motions'], actions: [
    ...moods.map(([mood, zh, en]): PreviewAction => ({ key: mood, name: [zh, en], cues: [{ animation: 'idle', mood }] })),
    single('blink', '眨眼', 'Blink'), single('tail', '轻摆尾巴', 'Tail swish'),
    single('greet', '问候', 'Greet'), single('farewell', '告别', 'Farewell'),
    single('happy', '开心抬爪', 'Happy paw lift'), single('stretch', '伸懒腰', 'Stretch'),
  ] },
  { label: ['互动与休息', 'Care and rest'], actions: [
    { key: 'pet-left', name: ['向左贴脸', 'Pet from the left'], cues: [{ animation: 'petting', direction: -1 }] },
    { key: 'pet-right', name: ['向右贴脸', 'Pet from the right'], cues: [{ animation: 'petting', direction: 1 }] },
    ...foods.map(([food, zh, en]): PreviewAction => ({ key: food, name: [zh, en], cues: [{ animation: 'eating', food }] })),
    { key: 'rest', name: ['钻被窝、熟睡与醒来', 'Tuck in, sleep and wake'],
      cues: [{ animation: 'sleeping', hold: 5100 }, { animation: 'waking' }] },
    { key: 'wake', name: ['醒来', 'Wake up'], cues: [{ animation: 'sleeping', hold: 1350 }, { animation: 'waking' }] },
    single('dragging', '起拖与落位', 'Pick up and set down', 1320),
  ] },
  { label: ['玩耍与聊天', 'Play and chat'], actions: [
    single('yarn', '拨毛线球', 'Play with yarn'), single('reading', '翻魔法书', 'Read the spellbook'),
    single('math', '解数学题', 'Solve math'), single('experiment', '做小实验', 'Run an experiment'),
    single('thinking', '聊天思考', 'Thinking', 3500), single('speaking', '回复', 'Replying', 3500),
    single('error', '回复出错', 'Reply error'),
  ] },
  { label: ['打断收势', 'Interrupted motions'], actions: [
    { key: 'interrupt-before', name: ['碰球前切换到抚摸', 'Pet before the ball is touched'],
      cues: [{ animation: 'yarn', hold: 1450 }, { animation: 'petting', direction: -1 }] },
    { key: 'interrupt-after', name: ['碰球后切换到抚摸', 'Pet after the ball is touched'],
      cues: [{ animation: 'yarn', hold: 2300 }, { animation: 'petting', direction: 1 }] },
    { key: 'interrupt-bed', name: ['钻被窝途中收势', 'Stop before tucking in'],
      cues: [{ animation: 'sleeping', hold: 720 }, { animation: 'idle' }] },
  ] },
];

const options = categories.flatMap(category => category.actions);

export function PetActionPreview({ skin, gentle, t }: {
  skin: SkinId; gentle: boolean; t: ReturnType<typeof translator>;
}) {
  const title = useId();
  const selectId = useId();
  const [selected, select] = useState('calm');
  const [cue, setCue] = useState<Cue>({ animation: 'idle' });
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const token = useRef(0);
  const timer = useRef<number>(0);
  const pending = useRef<Cue[]>([]);
  const current = useRef<Cue>(undefined);

  function show(next: Cue) {
    current.current = next;
    setCue(next);
    setRevision(++token.current);
  }

  function stop() {
    window.clearTimeout(timer.current);
    pending.current = [];
    show({ animation: 'idle' });
    setPlaying(false);
  }

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    stop();
  }, [skin]);

  function advance() {
    const next = pending.current.shift();
    if (next) {
      show(next);
      if (next.animation === 'idle' && !pending.current.length) setPlaying(false);
    }
    else stop();
  }

  function started(clip: ClipName, id?: number) {
    if (id !== token.current) return;
    const action = current.current;
    if (action?.hold === undefined) return;
    const minimum = clip === 'sleeping' && action.hold > 1000 ? clipDuration(skin, clip) : 0;
    timer.current = window.setTimeout(() => {
      if (token.current === id) advance();
    }, Math.max(minimum, action.hold));
  }

  function ended(_clip: ClipName, id?: number) {
    if (id === token.current && current.current?.hold === undefined && current.current?.animation !== 'idle') advance();
  }

  function play() {
    const action = options.find(option => option.key === selected) ?? options[0];
    const [first, ...rest] = action.cues;
    window.clearTimeout(timer.current);
    pending.current = rest;
    setPlaying(first.animation !== 'idle');
    show(first);
  }

  return <section className="setting-card pet-preview-card" aria-labelledby={title}>
    <h2 id={title}>{t('动作预览', 'Animation preview')}</h2>
    <div className="pet-preview-layout">
      <div className="pet-preview-stage">
        <div className="pet-preview-figure"><PetScene frame={cue} skin={skin} gentle={gentle} mood={cue.mood}
          petDirection={cue.direction} revision={revision} onPlaybackStart={started} onPlaybackEnd={ended} /></div>
      </div>
      <div className="pet-preview-controls">
        <label htmlFor={selectId}>{t('选择动作', 'Choose an action')}</label>
        <select id={selectId} value={selected} onChange={event => { stop(); select(event.target.value); }}>
          {categories.map(({ label, actions }) => <optgroup key={label[1]} label={t(...label)}>
            {actions.map(action => <option key={action.key} value={action.key}>{t(...action.name)}</option>)}
          </optgroup>)}
        </select>
        <div className="pet-preview-buttons" role="group" aria-label={t('预览控制', 'Preview controls')}>
          <button className="secondary pet-preview-button" type="button" onClick={play}>
            <PetIcon name="play" />{t('播放', 'Play')}
          </button>
          <button className="secondary pet-preview-button" type="button" onClick={play}>
            <PetIcon name="replay" />{t('重播', 'Replay')}
          </button>
          <button className="secondary pet-preview-button" type="button" onClick={stop} disabled={!playing}>
            <PetIcon name="stop" />{t('停止', 'Stop')}
          </button>
        </div>
      </div>
    </div>
  </section>;
}
