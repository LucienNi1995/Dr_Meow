import { useEffect, useRef, useState } from 'react';
import type { Animation, Food, PetAction, PetState, Settings } from '../shared/contracts.ts';
import type { translator } from '../shared/i18n.ts';
import { displayedStat, moodFor } from '../shared/petCare.ts';
import { desktop } from './common.tsx';
import { foodNames, PetIcon, type PetSymbol } from './pet/PetIcon.tsx';
import { PetScene } from './pet/PetScene.tsx';
import { moodNames } from './pet/PetStatusCard.tsx';
import type { PetFrame } from './pet/AnimationStateMachine.ts';
import './chat-care.css';

export function ChatCare({ pet, settings, t }: {
  pet?: PetState; settings?: Settings; t: ReturnType<typeof translator>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [food, setFood] = useState(false);
  const [frame, setFrame] = useState<PetFrame>();
  const [notice, setNotice] = useState(false);
  const ticket = useRef<string | undefined>(undefined);
  const timer = useRef<number>(0);
  const animation = useRef<Animation | undefined>(undefined);
  const mood = pet ? moodFor(pet) : 'calm';

  function stop() {
    if (ticket.current) desktop.cancelPetAction(ticket.current);
    ticket.current = undefined;
    window.clearTimeout(timer.current);
    setFrame(undefined);
  }

  useEffect(() => {
    const cancel = () => {
      if (ticket.current) desktop.cancelPetAction(ticket.current);
      ticket.current = undefined;
      window.clearTimeout(timer.current);
    };
    const unsubscribe = desktop.onAnimation((next, meal, id) => {
      if (!id) return;
      cancel();
      ticket.current = id;
      animation.current = next;
      setExpanded(true);
      setNotice(false);
      setFrame({ animation: next, food: meal, until: performance.now() });
      timer.current = window.setTimeout(() => {
        cancel();
        setFrame(undefined);
      }, 8000);
    });
    const hide = () => {
      if (document.hidden) { cancel(); setFrame(undefined); }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancel();
      unsubscribe();
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);

  async function care(action: PetAction) {
    try {
      setNotice(!await desktop.careInChat(action));
    } catch {
      setNotice(true);
    }
  }

  useEffect(() => {
    if (pet?.restingSince === undefined && !ticket.current) {
      setFrame(current => current?.animation === 'sleeping' ? undefined : current);
    }
  }, [pet?.restingSince]);

  function finished() {
    window.clearTimeout(timer.current);
    if (animation.current === 'sleeping') return;
    if (ticket.current) desktop.cancelPetAction(ticket.current);
    ticket.current = undefined;
    setFrame(undefined);
  }

  const items = [
    ['bowl', 'fullness', t('饱食度', 'Fullness')],
    ['mood', 'mood', t('心情', 'Mood')],
    ['heart', 'affection', t('亲密度', 'Affection')],
  ] as const;
  const rest = pet?.restingSince !== undefined;
  const restingFrame = frame ?? (rest ? { animation: 'sleeping' as const } : undefined);
  const button = (icon: PetSymbol, label: string, action: () => void) =>
    <button className="pill care-action" type="button" onClick={action}><PetIcon name={icon} /><span>{label}</span></button>;

  return <section className="chat-care" aria-label={t('照料猫咪', 'Care for your cat')}>
    <div className="chat-care-summary">
      {items.map(([icon, key, label]) => <span key={key} className="chat-care-stat" title={key === 'mood' ? t(...moodNames[mood]) : label}>
        <PetIcon name={icon} liquid={pet?.[key] ?? 0} mood={mood} />
        <span>{label}<strong>{pet ? displayedStat(pet[key]) : '—'}</strong></span>
      </span>)}
      <button className="pill" type="button" aria-expanded={expanded} onClick={() => {
        if (expanded) stop();
        setExpanded(!expanded);
      }}>{t('照料', 'Care')} {expanded ? '⌃' : '⌄'}</button>
    </div>
    {expanded && <div className="chat-care-panel">
      {restingFrame && <div className="chat-care-preview">
        <PetScene frame={restingFrame} skin={settings?.skin ?? 'original'}
          gentle={settings?.animation === 'gentle'} careId={ticket.current}
          onContact={id => {
            if (ticket.current !== id || document.hidden) return;
            ticket.current = undefined;
            desktop.settlePetAction(id);
          }} onPlaybackEnd={finished} />
      </div>}
      <div className="chat-care-buttons">
        {food ? <>
          {button('back', t('返回', 'Back'), () => setFood(false))}
          {(Object.keys(foodNames) as Food[]).map(value => <button className="pill care-action" type="button" key={value}
            onClick={() => void care({ type: 'feed', food: value })}>
            <PetIcon name={value} /><span>{t(...foodNames[value])}</span>
          </button>)}
        </> : <>
          {button('pet', t('抚摸', 'Pet'), () => void care({ type: 'pet' }))}
          {button('bowl', t('喂食', 'Feed'), () => setFood(true))}
          {button('yarn', t('玩耍', 'Play'), () => void care({ type: 'play' }))}
          {button(rest ? 'sun' : 'moon', rest ? t('叫醒', 'Wake') : t('休息', 'Rest'),
            () => void care({ type: rest ? 'wake' : 'sleep' }))}
        </>}
      </div>
      {notice && <span className="muted" role="status">{t('稍等片刻再试一次，喵。', 'Give me a moment, meow.')}</span>}
    </div>}
  </section>;
}

