import type { Animation, Food, PetGains, PetState, QuotaState } from '../../shared/contracts.ts';
import { displayedStat, type Mood } from '../../shared/petCare.ts';
import type { translator } from '../../shared/i18n.ts';
import { foodNames, PetIcon, PetIconButton, type PetSymbol } from './PetIcon.tsx';
import './pet-status.css';

export const moodNames: Record<Mood, [string, string]> = {
  calm: ['安静', 'Calm'], content: ['满足', 'Content'], happy: ['开心', 'Happy'], curious: ['想陪玩', 'Wants to play'],
};

function Indicator({ name, label, value, mood, detail, changed }: {
  name: PetSymbol; label: string; value?: number; mood?: Mood; detail?: string; changed?: boolean;
}) {
  const amount = value === undefined ? undefined : displayedStat(value);
  return <span className="pet-stat" data-stat={name} data-gain={changed || undefined}>
    <span className="pet-stat-level" role={amount === undefined ? 'img' : 'meter'}
      aria-label={label} aria-valuemin={amount === undefined ? undefined : 0}
      aria-valuemax={amount === undefined ? undefined : 100} aria-valuenow={amount}
      aria-valuetext={amount === undefined || !detail ? undefined : `${amount} / 100 · ${detail}`}>
      <PetIcon name={name} liquid={amount ?? 0} mood={mood} />
      <span className="pet-stat-number" aria-hidden="true">{amount ?? '—'}</span>
    </span>
    <span className="pet-stat-name" aria-hidden="true">{label}</span>
    {detail && <span className="pet-stat-detail" aria-hidden="true">{detail}</span>}
  </span>;
}

export function PetLabeledAction({ name, label, accessibleLabel = label, level, pressed, onClick }: {
  name: PetSymbol; label: string; accessibleLabel?: string; level?: number; pressed?: boolean; onClick(): void;
}) {
  return <PetIconButton name={name} label={accessibleLabel} visibleLabel={label} level={level}
    aria-pressed={pressed} onClick={onClick} />;
}

interface Props {
  pet?: PetState;
  mood: Mood;
  gains?: PetGains;
  quota?: QuotaState;
  animation: Animation;
  compact?: boolean;
  foodMenu?: { back(): void; choose(food: Food): void };
  t: ReturnType<typeof translator>;
  chat(): void;
  petCat(): void;
  feed(): void;
  play(): void;
  rest(): void;
  usage(): void;
}

export function PetStatusCard({ pet, mood, gains, quota, animation, compact, foodMenu, t, chat, petCat, feed, play, rest, usage }: Props) {
  const sleeping = animation === 'sleeping';
  const limited = quota === 'limited';
  return <>
    <div className="pet-state-grid" role="group" aria-label={t('猫咪状态', 'Cat status')}>
      <Indicator name="bowl" label={t('饱食度', 'Fullness')} value={pet?.fullness} changed={!!gains?.fullness} />
      <Indicator name="mood" label={t('心情', 'Mood')} value={pet?.mood} mood={mood}
        detail={t(...moodNames[mood])} changed={!!gains?.mood} />
      <Indicator name="heart" label={t('亲密度', 'Affection')} value={pet?.affection} changed={!!gains?.affection} />
      <PetIconButton name="energy" className="pet-stat-energy" visibleLabel="Energy" limited={limited} onClick={usage}
        label={limited ? t('Energy · ChatGPT 用量受限，打开概览', 'Energy · ChatGPT usage limited, open overview')
          : t('Energy · 查看浏览器中的 ChatGPT 用量', 'Energy · View ChatGPT usage in your browser')}>
        <span className="pet-stat-detail">{limited ? t('用量受限', 'Limited') : t('查看用量', 'View usage')}</span>
      </PetIconButton>
    </div>
    {!compact && (foodMenu
      ? <div className="pet-status-actions pet-status-food" role="group" aria-label={t('选择食物', 'Choose food')}>
        <PetLabeledAction name="back" label={t('返回', 'Back')} onClick={foodMenu.back} />
        {(Object.keys(foodNames) as Food[]).map(food => <PetLabeledAction key={food} name={food}
          label={t(...foodNames[food])} onClick={() => foodMenu.choose(food)} />)}
      </div>
      : <div className="pet-status-actions" role="group" aria-label={t('互动', 'Interactions')}>
        <PetLabeledAction name="pet" label={t('抚摸', 'Pet')} onClick={petCat} />
        <PetLabeledAction name="bowl" level={2} label={t('喂食', 'Feed')} onClick={feed} />
        <PetLabeledAction name="yarn" label={t('玩耍', 'Play')} accessibleLabel={t('玩耍 · 拨毛线球', 'Play with yarn')} onClick={play} />
        <PetLabeledAction name={sleeping ? 'sun' : 'moon'} label={sleeping ? t('叫醒', 'Wake') : t('休息', 'Rest')} onClick={rest} />
        <PetLabeledAction name="chat" label={t('聊天', 'Chat')} onClick={chat} />
      </div>)}
  </>;
}

