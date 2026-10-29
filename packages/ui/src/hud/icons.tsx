import type { CheerEmoji, EnemyKind, Role } from '@sats-wars/shared';

/**
 * SATS WARS HUD glyphs: one stroke family on a 24-unit grid, square ends,
 * drawn for this game (no emoji, no stock icon set). Friendly things are
 * squares/circles, hostile things are diamonds, as on a tactical display.
 */
const PATHS = {
  // Stations
  gunner: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      <path d="M12 11.2v1.6M11.2 12h1.6" />
    </>
  ),
  guardian: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M12 7v10M8.5 10.5h7" />
    </>
  ),
  router: (
    <>
      <path d="M3 12h6M9 12l5-6h4M9 12h9M9 12l5 6h4" />
      <rect x="18" y="4.5" width="3" height="3" />
      <rect x="18" y="10.5" width="3" height="3" />
      <rect x="18" y="16.5" width="3" height="3" />
      <circle cx="9" cy="12" r="1.6" />
    </>
  ),
  engineer: (
    <>
      <path d="M8.5 4.5l4 0 2 3.5-2 3.5-4 0-2-3.5z" />
      <circle cx="10.5" cy="8" r="1.4" />
      <path d="M12.5 11.5l7 7-2 2-7-7" />
    </>
  ),
  // Robots and the boss
  raijin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M13 5.5l-5 7.5h4l-1 5.5 5-7.5h-4z" />
    </>
  ),
  fujin: (
    <>
      <path d="M4 13a8 8 0 0 1 13.6-6.6" />
      <path d="M20 11a8 8 0 0 1-13.6 6.6" />
      <path d="M8 12a4 4 0 0 1 6.8-2.8M16 12a4 4 0 0 1-6.8 2.8" />
    </>
  ),
  boss: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4.5 19.5l15-15" />
    </>
  ),
  // Hostile tracks (diamond + type mark)
  scout: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
      <path d="M12 11v2" />
    </>
  ),
  siege: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
      <path d="M8 12h8M12 9v6" />
    </>
  ),
  saboteur: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
      <path d="M8 12l2-2 2 4 2-4 2 2" />
    </>
  ),
  hostile: <path d="M12 3l9 9-9 9-9-9z" />,
  // Friendly installation (city)
  city: (
    <>
      <rect x="5" y="5" width="14" height="14" />
      <path d="M9 19v-6h6v6" />
    </>
  ),
  // Status
  warning: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 9.5v5M12 17v1" />
    </>
  ),
  lock: (
    <>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  energy: <path d="M13.5 2.5L6 13.5h5l-1 8 7.5-11h-5z" />,
  jam: <path d="M2 12h4l2-5 3 10 2-6h2M18 12h4M16 8l3 8" />,
  sync: <path d="M3 7l6 5-6 5M21 7l-6 5 6 5M9 12h6" />,
  reserve: (
    <>
      <rect x="3" y="7" width="15" height="10" />
      <path d="M18 10h3v4h-3M6 10v4M9 10v4M12 10v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  link: <path d="M4 20v-3M9 20v-7M14 20v-11M19 20V5" />,
  shieldUp: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  crack: <path d="M12 3l-2 6 4 3-3 4 1 5M14 12l5-2M10 9L5 8" />,
  // Controls
  sound: <path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" />,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4l12 8-12 8z" />,
  menu: <path d="M3 6h18M3 12h18M3 18h12" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 4l-8 8 8 8" />,
  left: <path d="M14 5l-7 7 7 7M21 12H8" />,
  up: <path d="M5 13l7-7 7 7M12 6v14" />,
  right: <path d="M10 5l7 7-7 7M3 12h13" />,
  launch: <path d="M5 12l7-7 7 7M5 19l7-7 7 7" />,
  pilot: (
    <>
      <path d="M5 13a7 7 0 0 1 14 0v4H5z" />
      <path d="M7.5 12.5h9" />
      <path d="M9 21h6" />
    </>
  ),
  crew: (
    <>
      <path d="M2.5 14a5 5 0 0 1 10 0v3h-10z" />
      <path d="M11.5 11a5 5 0 0 1 10 0v3h-6" />
    </>
  ),
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  sim: (
    <>
      <rect x="3" y="4" width="18" height="12" />
      <path d="M10 8l4 2-4 2zM8 20h8M12 16v4" />
    </>
  ),
  station: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 9h16M9 9v11" />
    </>
  ),
  // Comms (cheer)
  horn: <path d="M3 10v4h3l9 5V5l-9 5zM6 14l1.5 5M18 9.5a3.5 3.5 0 0 1 0 5" />,
  flame: (
    <path d="M12 21c-3.5 0-6-2.4-6-5.6 0-3.6 3-5.4 4-9.4 2.6 1.7 4 4.2 4 6.6 1-.6 1.6-1.6 1.8-2.8 1.4 1.4 2.2 3.3 2.2 5.4 0 3.4-2.5 5.8-6 5.8z" />
  ),
  swirl: <path d="M12 12a2 2 0 1 1 2 2 4 4 0 1 1-4-4 6 6 0 1 1 6 6" />,
  spark: <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" />,
  fist: (
    <>
      <path d="M6 10h11a2 2 0 0 1 2 2v3a6 6 0 0 1-6 6h-2a5 5 0 0 1-5-5z" />
      <path d="M6 10V7h3v3M9 7V5h3v5M12 6h3v4" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  className,
  title,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number | string;
  className?: string;
  /** Accessible name; without it the icon is decorative (aria-hidden). */
  title?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={`hud-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export const ROLE_ICON: Record<Role, IconName> = {
  GUNNER: 'gunner',
  GUARDIAN: 'guardian',
  ROUTER: 'router',
  ENGINEER: 'engineer',
};

export const ENEMY_ICON: Record<EnemyKind, IconName> = {
  SCOUT: 'scout',
  SIEGE: 'siege',
  SABOTEUR: 'saboteur',
  BOSS: 'boss',
};

/** Cheers travel as the protocol's emoji values; the HUD draws its own glyph for each. */
export const CHEER_ICON: Record<CheerEmoji, { icon: IconName; ja: string; en: string }> = {
  '📣': { icon: 'horn', ja: '声援', en: 'Rally' },
  '🔥': { icon: 'flame', ja: '熱く', en: 'Fire up' },
  '⚡': { icon: 'energy', ja: '雷神', en: 'Raijin' },
  '🌀': { icon: 'swirl', ja: '風神', en: 'Fujin' },
  '👏': { icon: 'spark', ja: 'ナイス', en: 'Nice' },
  '💪': { icon: 'fist', ja: '踏ん張れ', en: 'Hold on' },
};
