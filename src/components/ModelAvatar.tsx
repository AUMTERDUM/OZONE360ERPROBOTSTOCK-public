import React from 'react';
import { Bot } from 'lucide-react';
import RobotMascot from './RobotMascot';
import { mascotForModel } from '../utils/mascots';

/**
 * A robot model's picture: the uploaded product photo when there is one, otherwise the cartoon of
 * that model (static, so a table of them doesn't wobble), otherwise a plain robot icon.
 */
const ModelAvatar: React.FC<{ name?: string; imageUrl?: string | null; size?: number; style?: React.CSSProperties }> = ({ name, imageUrl, size = 44, style }) => {
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 8, flexShrink: 0, ...style };
  if (imageUrl) {
    return <img src={imageUrl} alt={name ?? ''} style={{ ...box, objectFit: 'contain', background: 'var(--bg-primary)', padding: 3 }} />;
  }
  const icon = (
    <div aria-hidden="true" style={{ ...box, display: 'grid', placeItems: 'center', background: 'var(--surface-soft)', color: 'var(--text-muted)' }}>
      <Bot size={Math.round(size * 0.5)} />
    </div>
  );
  const robot = mascotForModel(name);
  return robot ? <RobotMascot robot={robot} size={size} animation="none" style={{ flexShrink: 0, ...style }} fallback={icon} /> : icon;
};

export default ModelAvatar;
