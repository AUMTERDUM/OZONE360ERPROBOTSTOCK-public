import React, { useState } from 'react';
import { MASCOT_SCENES, type MascotAnimation, type MascotPose, type MascotRobot, type MascotScene } from '../utils/mascots';

type Props = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Rendered instead when no image file exists yet (e.g. the old Lucide icon). */
  fallback?: React.ReactNode;
} & (
  | { scene: MascotScene; robot?: never; pose?: never; animation?: MascotAnimation }
  | { scene?: never; robot: MascotRobot; pose?: MascotPose; animation?: MascotAnimation }
);

/**
 * Decorative cartoon robot. Tries public/mascots/<robot>-<pose>.webp, then <robot>.webp, and
 * renders `fallback` if neither exists — so the art can be dropped in later without code changes.
 * Motion is CSS-only and switched off under prefers-reduced-motion (see .mascot in index.css).
 */
const RobotMascot: React.FC<Props> = (props) => {
  const scene = props.scene ? MASCOT_SCENES[props.scene] : undefined;
  const robot = scene?.robot ?? props.robot!;
  const pose: MascotPose = scene?.pose ?? props.pose ?? 'default';
  const animation: MascotAnimation = props.animation ?? scene?.animation ?? 'float';
  const sources = pose === 'default' ? [`/mascots/${robot}.webp`] : [`/mascots/${robot}-${pose}.webp`, `/mascots/${robot}.webp`];
  // Remember failed URLs (not an index) so switching robot/pose retries from the top.
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find(s => !failed.includes(s));
  const size = props.size ?? 120;

  if (!src) return <>{props.fallback ?? null}</>;
  return (
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={`mascot mascot--${animation}${props.className ? ` ${props.className}` : ''}`}
      style={{ width: size, height: size, objectFit: 'contain', ...props.style }}
      onError={() => setFailed(f => [...f, src])}
    />
  );
};

export default RobotMascot;
