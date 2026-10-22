// Cartoon robot mascots. Images live in public/mascots/ (spec: docs/mascots.md) and are optional:
// until a file exists the mascot simply doesn't render, so pages work with or without the art.

export const MASCOT_ROBOTS = ['kettybot', 'bellabot', 'pudubot2', 'flashbot', 'mt1', 'cc1', 'sh1', 't150', 't300', 'humanoid'] as const;
export type MascotRobot = typeof MASCOT_ROBOTS[number];

/** Poses used by the app. Each maps to public/mascots/<robot>-<pose>.webp, falling back to <robot>.webp. */
export type MascotPose = 'default' | 'wave' | 'lost' | 'sweep' | 'empty' | 'search' | 'repair' | 'deliver' | 'celebrate' | 'sleep' | 'worried' | 'offline' | 'clean';

export type MascotAnimation = 'float' | 'wave' | 'sweep' | 'bounce' | 'search' | 'none';

/** Which robot + pose + motion each place in the app uses — one table so the cast is easy to change. */
export const MASCOT_SCENES = {
  login:         { robot: 'kettybot', pose: 'wave',      animation: 'wave' },
  notFound:      { robot: 't150',     pose: 'lost',      animation: 'search' },
  emptyList:     { robot: 'bellabot', pose: 'empty',     animation: 'float' },
  noResults:     { robot: 'humanoid', pose: 'search',    animation: 'search' },
  loadError:     { robot: 't300',     pose: 'repair',    animation: 'bounce' },
  emptyCleaning: { robot: 'cc1',      pose: 'clean',     animation: 'sweep' },
  repairPending: { robot: 't300',     pose: 'repair',    animation: 'bounce' },
  repairShip:    { robot: 'flashbot', pose: 'deliver',   animation: 'float' },
  repairDone:    { robot: 'humanoid', pose: 'celebrate', animation: 'bounce' },
  allClear:      { robot: 'bellabot', pose: 'celebrate', animation: 'bounce' },
  quiet:         { robot: 'mt1',      pose: 'sleep',     animation: 'float' },
  loading:       { robot: 'mt1',      pose: 'sweep',     animation: 'sweep' },
  crash:         { robot: 't300',     pose: 'repair',    animation: 'bounce' },
  confirmDanger: { robot: 'bellabot', pose: 'worried',   animation: 'search' },
  confirm:       { robot: 'kettybot', pose: 'default',   animation: 'float' },
  offline:       { robot: 'flashbot', pose: 'offline',   animation: 'float' },
  reportSent:    { robot: 'flashbot', pose: 'deliver',   animation: 'bounce' },
  maDone:        { robot: 'bellabot', pose: 'celebrate', animation: 'bounce' },
  morning:       { robot: 'kettybot', pose: 'wave',      animation: 'wave' },
  afternoon:     { robot: 'pudubot2', pose: 'default',   animation: 'float' },
  evening:       { robot: 'bellabot', pose: 'default',   animation: 'float' },
  night:         { robot: 'mt1',      pose: 'sleep',     animation: 'float' },
  sidebar:       { robot: 'kettybot', pose: 'default',   animation: 'float' },
  sidebarAlert:  { robot: 'kettybot', pose: 'wave',      animation: 'wave' },
} as const satisfies Record<string, { robot: MascotRobot; pose: MascotPose; animation: MascotAnimation }>;

export type MascotScene = keyof typeof MASCOT_SCENES;

const normalize = (name: string | undefined) => (name || '').toUpperCase().replace(/[\s\-_]/g, '');

/** Best mascot for a robot model name (for model avatars); undefined when no art fits. */
export function mascotForModel(modelName: string | undefined): MascotRobot | undefined {
  const n = normalize(modelName);
  if (!n) return undefined;
  if (n.includes('KETTY')) return 'kettybot';
  if (n.includes('FLASH')) return 'flashbot';
  if (n.includes('BELLA')) return 'bellabot';
  if (n.includes('PUDUBOT') || n === 'PUDU2' || n.includes('SWIFT') || n.includes('HOLA')) return 'pudubot2';
  if (n.includes('CC1')) return 'cc1';
  if (n.includes('SH1')) return 'sh1';
  if (n.includes('MT1')) return 'mt1';
  if (n.includes('T150')) return 't150';
  if (n.includes('T300') || n.includes('T600')) return 't300';
  if (n.includes('D7') || n.includes('D9') || n.includes('HUMANOID')) return 'humanoid';
  return undefined;
}

/** Greeting scene + Thai greeting for the current hour (Thai time). */
export function greetingForNow(date = new Date()): { scene: MascotScene; text: string } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Bangkok' }).format(date));
  if (hour >= 5 && hour < 12) return { scene: 'morning', text: 'สวัสดีตอนเช้า' };
  if (hour >= 12 && hour < 17) return { scene: 'afternoon', text: 'สวัสดีตอนบ่าย' };
  if (hour >= 17 && hour < 21) return { scene: 'evening', text: 'สวัสดีตอนเย็น' };
  return { scene: 'night', text: 'ทำงานดึกนะ พักบ้างด้วย' };
}
