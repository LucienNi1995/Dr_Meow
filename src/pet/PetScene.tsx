import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { SkinId } from '../../shared/contracts.ts';
import type { Mood } from '../../shared/petCare.ts';
import type { PetFrame } from './AnimationStateMachine.ts';
import { PetMotion } from './PetMotion.tsx';
import { posterUrl, type ClipName } from './frameAssets.ts';
import { activitySymbols, PetIcon, type PetSymbol } from './PetIcon.tsx';
import './pet.css';

interface Props {
  frame: PetFrame;
  skin: SkinId;
  gentle?: boolean;
  mood?: Mood;
  careId?: string;
  onContact?: (id: string) => void;
  petDirection?: number;
  portrait?: RefObject<HTMLImageElement | null>;
  poseLayer?: RefObject<HTMLSpanElement | null>;
  onArtChange?: () => void;
  gain?: PetSymbol;
  revision?: number;
  onPlaybackStart?: (clip: ClipName, revision?: number) => void;
  onPlaybackEnd?: (clip: ClipName, revision?: number) => void;
}

export function PetScene({
  frame, skin, gentle = false, petDirection = 1, portrait, poseLayer, onArtChange,
  mood, careId, onContact, gain, revision, onPlaybackStart, onPlaybackEnd,
}: Props) {
  const [motion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)'));
  const [reduced, setReduced] = useState(motion.matches);
  useEffect(() => {
    const update = () => setReduced(motion.matches);
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, [motion]);

  return <span className="pet-character" data-animation={frame.animation} data-skin={skin} aria-hidden="true">
    <span className="pet-pose" ref={poseLayer}>
      <span className="pet-art">
        <img key={skin} ref={portrait} className="pet-portrait" src={posterUrl(skin)}
          onLoad={onArtChange} alt="" draggable={false} />
        <PetMotion frame={frame} skin={skin} mood={mood} gentle={gentle} petDirection={petDirection}
          reduced={reduced} revision={revision} careId={careId} onContact={onContact}
          warm={!!portrait} onPlaybackStart={onPlaybackStart} onPlaybackEnd={onPlaybackEnd} />
      </span>
    </span>
    <ExpressionEffect key={revision ?? frame.until ?? frame.animation} animation={frame.animation} animated={!gentle && !reduced} />
    {gain && <span className="pet-gain-badge"><PetIcon name={gain} level={3} mood={mood} /></span>}
  </span>;
}

function ExpressionEffect({ animation, animated }: { animation: PetFrame['animation']; animated: boolean }) {
  const activity = activitySymbols[animation];
  if (activity) return <span className="pet-activity-badge"><PetIcon name={activity} level={2} /></span>;
  if (animated && (animation === 'petting' || animation === 'happy')) return <span className="pet-effect pet-hearts">
    <i><PetIcon name="heart" level={4} /></i><i><PetIcon name="heart" level={4} /></i>
  </span>;
  if (animated && (animation === 'greet' || animation === 'waking')) {
    return <span className="pet-effect pet-sparkle"><PetIcon name="spark" /></span>;
  }
  return null;
}
