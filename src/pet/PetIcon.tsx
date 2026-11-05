import { useId, type ButtonHTMLAttributes } from 'react';
import type { Animation, Food } from '../../shared/contracts.ts';
import type { Mood } from '../../shared/petCare.ts';

export type PetSymbol =
  'bowl' | 'mood' | 'heart' | 'energy' | 'pet' | 'yarn' | 'moon' | 'sun' | 'chat' |
  'fish' | 'can' | 'treat' | 'settings' | 'pin' | 'exit' | 'back' | 'close' | 'search' |
  'book' | 'math' | 'flask' | 'sit' | 'thought' | 'spark' | 'play' | 'replay' | 'stop';

export const foodNames: Record<Food, [string, string]> = {
  fish: ['小鱼干', 'Dried fish'], can: ['猫罐头', 'Wet food'], treat: ['猫条', 'Cat treat'],
};
export const activitySymbols: Partial<Record<Animation, PetSymbol>> = {
  sleeping: 'moon', reading: 'book', thinking: 'thought', speaking: 'chat',
  eating: 'bowl', yarn: 'yarn', math: 'math', experiment: 'flask',
};

interface Props {
  name: PetSymbol;
  mood?: Mood;
  level?: number;
  limited?: boolean;
  liquid?: number;
}

function LiquidWell({ shape, top, bottom, value }: { shape: string; top: number; bottom: number; value: number }) {
  const clip = useId();
  const height = bottom - top;
  return <>
    <clipPath id={clip}><path d={shape} /></clipPath>
    <path d={shape} className="pet-liquid-well" stroke="none" />
    <g clipPath={`url(#${clip})`}>
      <g className="pet-liquid-fill" style={{ transform: `translateY(${height * (100 - value) / 100}px)` }}>
        <rect x="0" y={top} width="24" height={height} stroke="none" />
        <path d={`M0 ${top + .5}q4 -1 8 0t8 0t8 0`} className="pet-liquid-surface"
          strokeOpacity={value === 0 || value === 100 ? 0 : undefined} />
        {value > 0 && value < 100 && <path d={`M4 ${top + 1.6}q4 -1 8 0t8 0`} className="pet-liquid-ripple" />}
      </g>
    </g>
    <path d={shape} />
  </>;
}

export function PetIcon({ name, mood = 'calm', level = 0, limited = false, liquid }: Props) {
  const bowl = 'M3.5 10h17l-2.1 6.8a3 3 0 0 1-2.9 2.2h-7a3 3 0 0 1-2.9-2.2Z';
  const face = mood === 'curious' ? 'M4 11 4.7 4.2 10 7h5l3.7-2.8 1.3 7c2 5.5-1.2 8.8-8 8.8S2 16.8 4 11Z'
    : 'M4 11 4.8 4.5 9 7h6l4.2-2.5L20 11c2 5.5-1.2 8.5-8 8.5S2 16.5 4 11Z';
  const heart = 'M12 19.6 4.9 13a4.5 4.5 0 0 1 6.4-6.4l.7.8.7-.8a4.5 4.5 0 0 1 6.4 6.4Z';
  let shape;
  switch (name) {
    case 'bowl':
      shape = <>{liquid === undefined ? <><path d={bowl} className="pet-icon-soft" />
        {[0, 1, 2, 3].map(i => <rect key={i} x={7.25 + i * 2.6} y="13" width="1.65" height="3" rx=".65"
          fill={i < level ? 'currentColor' : '#fff4e9'} stroke="none" />)}</> : <LiquidWell shape={bowl} top={10} bottom={19} value={liquid} />}
        <path d="M5 10c.7-2.5 2.4-3.6 4.6-3l1.8-1.2 2.4 1.3c1.9-.5 3.8.4 4.6 2.9" /></>;
      break;
    case 'mood':
      shape = <>{liquid === undefined ? <path d={face} className="pet-icon-soft" />
        : <LiquidWell shape={face} top={mood === 'curious' ? 4.2 : 4.5} bottom={mood === 'curious' ? 20 : 19.5} value={liquid} />}
        {mood === 'content' || mood === 'happy' ? <path d="M7.3 12q1.4-2 2.8 0m3.8 0q1.4-2 2.8 0" />
          : <><circle cx="8.7" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15.3" cy="12" r="1" fill="currentColor" stroke="none" /></>}
        {mood === 'happy' ? <path d="M9.8 14.6h4.4q-2.2 4.1-4.4 0Z" fill="currentColor" strokeWidth=".65" />
          : mood === 'curious' ? <circle cx="12" cy="15.2" r="1.15" />
          : <path d="M10.2 14.8q1.8 2.2 3.6 0" />}</>;
      break;
    case 'heart':
      shape = liquid === undefined ? <path d={heart} fill={level ? 'currentColor' : 'none'} fillOpacity={level ? .16 + level * .18 : 0} />
        : <LiquidWell shape={heart} top={5.15} bottom={19.6} value={liquid} />;
      break;
    case 'energy':
      shape = <><path d="m13.3 3-8 10h5.8l-.7 8 8.3-10.5h-5.9Z" className="pet-icon-soft" />
        {limited ? <path d="M20 4v3m0 2.4v.1" stroke="#a34a4e" /> : <path d="M18 4h3v3m0-3-3 3" />}</>;
      break;
    case 'pet':
      shape = <><path d="M6.3 13.2 5 10.4a1.4 1.4 0 0 1 2.4-1.2l1.6 2.2V6a1.1 1.1 0 1 1 2.2 0v3.6-5a1.1 1.1 0 0 1 2.2 0v5-4a1.1 1.1 0 0 1 2.2 0v4.6-2.5a1.1 1.1 0 0 1 2.2 0v6.7c0 3-2 5.3-5.1 5.3h-.9c-2.4 0-4.4-3.4-5.5-6.5Z" className="pet-icon-soft" /><path d="M2.6 5.7l2 .8M5.1 3.6l.7 1.9" /></>;
      break;
    case 'yarn':
      shape = <><circle cx="12.5" cy="10.3" r="6.5" className="pet-icon-soft" /><path d="M7 8.3c3-3 8.6-3 11.5.1M6.3 11c3.8-3 8.1-3.1 12.5.1M9 5.1c.6 4.9 2.8 8.4 6.7 10.8m.9-.6c-3.1 5.6-10.7 5.7-12.4 3.6-.8-1 .2-2.4 1.5-2.2" /></>;
      break;
    case 'moon':
      shape = <><path d="M17.3 15.9A7.4 7.4 0 0 1 8.7 5a7.8 7.8 0 1 0 8.6 10.9Z" className="pet-icon-soft" /><path d="M16 4.6v4m-2-2h4m2.3 3v2.8M19 11h2.7" /></>;
      break;
    case 'sun':
      shape = <><circle cx="12" cy="12" r="4.8" className="pet-icon-soft" /><path d="M12 2.8v2m0 14.4v2M2.8 12h2m14.4 0h2M5.4 5.4l1.4 1.4m10.4 10.4 1.4 1.4m0-13.2-1.4 1.4M6.8 17.2l-1.4 1.4" /></>;
      break;
    case 'chat':
    case 'thought':
      shape = <><path d="M4 5.5h16V16H11l-4.7 3v-3H4Z" className="pet-icon-soft" strokeLinejoin="round" /><path d="M8 11h.1m3.9 0h.1m3.9 0h.1" strokeWidth="2.1" /></>;
      break;
    case 'fish':
      shape = <><path d="M7 12C11 5 18 7.6 21 12c-3 4.4-10 7-14 0Zm0 0-4-3.4v6.8Z" className="pet-icon-soft" /><path d="M16.7 11h.1" strokeWidth="2" /></>;
      break;
    case 'can':
      shape = <><path d="M5.5 7v10c0 3.4 13 3.4 13 0V7" className="pet-icon-soft" /><ellipse cx="12" cy="7" rx="6.5" ry="2.8" className="pet-icon-soft" /><path d="M9 7h3m-2.2 6.1q2.2-2.5 4.4 0-2.2 2.5-4.4 0Zm-.1 0-1.3-1v2Z" /></>;
      break;
    case 'treat':
      shape = <><path d="m5.5 18.8-2.2-3.4L17 4.2l3.2 3.9L7.7 20Z" className="pet-icon-soft" /><path d="m14.8 6 3.3 3.9m-8.2 4 3.8-3.4" /></>;
      break;
    case 'settings':
      shape = <><path d="m9.2 5 1.1-2.1h3.4l1.1 2.1 2.3.9 2.4-.2 1.7 2.9-1.3 1.9v2.9l1.3 2-1.7 2.9-2.4-.2-2.3.9-1.1 2.1h-3.4L9.2 19 7 18.1l-2.4.2-1.7-2.9 1.3-2v-2.9L2.9 8.6l1.7-2.9 2.4.2Z" className="pet-icon-soft" /><circle cx="12" cy="12" r="3.1" /></>;
      break;
    case 'pin':
      shape = <><path d="m13 3.6 7.4 7.4-2 1.9-2.3-.9-3 3v2L6.8 11h2.1l3-3L11 5.6Z" className="pet-icon-soft" /><path d="m9.8 14.1-6 6" /></>;
      break;
    case 'exit':
      shape = <><path d="M10 5H5v14h5m4-3 4-4-4-4m-4 4h8" /></>;
      break;
    case 'close':
      shape = <path d="m7 7 10 10M17 7 7 17" />;
      break;
    case 'back':
      shape = <path d="m10 5-7 7 7 7M4 12h16" />;
      break;
    case 'search':
      shape = <><circle cx="10.5" cy="10.5" r="5.4" className="pet-icon-soft" /><path d="m14.5 14.5 5 5" /></>;
      break;
    case 'book':
      shape = <><path d="M3.5 5.5c3.6-.8 6.4.2 8.5 2.2 2.1-2 4.9-3 8.5-2.2v12c-3.6-.8-6.4.2-8.5 2.2-2.1-2-4.9-3-8.5-2.2Z" className="pet-icon-soft" /><path d="M12 8v11m3-8h3m-3 2.9h2.2" /></>;
      break;
    case 'math':
      shape = <><path d="M5 4.5h10.5v15H5Z" className="pet-icon-soft" /><path d="M7.6 9h4.3m-4.3 3h2.7m.8 4.5 6.7-7 2 2.1-6.8 6.9-2.9.7Z" /></>;
      break;
    case 'flask':
      shape = <><path d="M9 3.5h6m-5 0V10l-5.1 8a1.5 1.5 0 0 0 1.3 2.2h11.6a1.5 1.5 0 0 0 1.3-2.2L14 10V3.5" className="pet-icon-soft" /><path d="M7.2 15.5q2.3-1.8 5.2 0t4.3-.1m-3.7 2.8h.1" /></>;
      break;
    case 'sit':
      shape = <path d="M5 13.7 5 5.4 9.7 8h3.6l4.6-2.6v7.5c2.8.8 3.2 5.9-.1 6.3H7.7C5.3 19 4 16.7 5 13.7Z" className="pet-icon-soft" />;
      break;
    case 'spark':
      shape = <path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z" className="pet-icon-soft" />;
      break;
    case 'play':
      shape = <path d="m8 5 11 7-11 7Z" className="pet-icon-soft" />;
      break;
    case 'replay':
      shape = <><path d="M5 10a7 7 0 1 1-.1 4.1M5 5v5h5" /><path d="m10.3 9.2 4.1 2.8-4.1 2.8Z" className="pet-icon-soft" /></>;
      break;
    case 'stop':
      shape = <rect x="6" y="6" width="12" height="12" rx="2" className="pet-icon-soft" />;
      break;
  }
  return <svg className="pet-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shape}</svg>;
}

export function PetIconButton({ name, label, visibleLabel, mood, level, limited, className, children, ...props }:
  Props & ButtonHTMLAttributes<HTMLButtonElement> & { label: string; visibleLabel?: string }) {
  return <button type="button" aria-label={label} title={label} data-hint={visibleLabel ? undefined : label}
    className={['pet-icon-button', visibleLabel && 'pet-labeled-button', className].filter(Boolean).join(' ')} {...props}>
    <PetIcon name={name} mood={mood} level={level} limited={limited} />
    {visibleLabel && <span>{visibleLabel}</span>}{children}
  </button>;
}

