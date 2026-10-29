import type { RoleId } from '@swed/shared';

/** Same palette as tokens.css, for canvas/WebGL code that cannot read CSS variables. */
export const COLORS = {
  void: '#050B13',
  surface: '#0A1A27',
  metal: '#263844',
  line: '#446070',
  text: '#E5EEF3',
  muted: '#93AEBC',
  ally: '#5BCADA',
  action: '#F2AD4D',
  danger: '#EF596B',
  repair: '#79D8B4',
  power: '#7FE0B0',
} as const;

export const ROLE_COLOR: Record<RoleId, string> = {
  GUNNER: COLORS.action,
  DEFENSE: COLORS.ally,
  POWER: COLORS.power,
  ENGINEER: COLORS.repair,
};

export const ROLE_VAR: Record<RoleId, string> = {
  GUNNER: 'var(--sw-action)',
  DEFENSE: 'var(--sw-ally)',
  POWER: 'var(--sw-power)',
  ENGINEER: 'var(--sw-repair)',
};

export * from './icons';
