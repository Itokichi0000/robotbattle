export const TEAM_IDS = ['RAIJIN', 'FUJIN'] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export function otherTeam(teamId: TeamId): TeamId {
  return teamId === 'RAIJIN' ? 'FUJIN' : 'RAIJIN';
}

export function isTeamId(value: unknown): value is TeamId {
  return value === 'RAIJIN' || value === 'FUJIN';
}

export interface TeamMeta {
  teamId: TeamId;
  colorName: 'ORANGE' | 'BLUE';
  color: string;
  colorDark: string;
  colorLight: string;
  robotId: 'raijin' | 'fujin';
  nameJa: string;
  nameEn: string;
  /** Non-color identifier so the team is recognisable without color perception. */
  symbol: string;
  attackJa: string;
  attackEn: string;
  guardJa: string;
  guardEn: string;
  specialJa: string;
  specialEn: string;
}

/**
 * Presentation-only metadata. Gameplay stats are identical for both teams and
 * live in GameConfig, never here.
 */
export const TEAM_META: Record<TeamId, TeamMeta> = {
  RAIJIN: {
    teamId: 'RAIJIN',
    colorName: 'ORANGE',
    color: '#F7931A',
    colorDark: '#8A4A06',
    colorLight: '#FFC46B',
    robotId: 'raijin',
    nameJa: '雷神',
    nameEn: 'RAIJIN',
    symbol: '⚡',
    attackJa: '雷撃拳',
    attackEn: 'Thunder Impact',
    guardJa: '雷電障壁',
    guardEn: 'Raiden Barrier',
    specialJa: '天雷轟破',
    specialEn: 'Tenrai Gōha',
  },
  FUJIN: {
    teamId: 'FUJIN',
    colorName: 'BLUE',
    color: '#25C8D7',
    colorDark: '#0B5C6B',
    colorLight: '#8BEAF2',
    robotId: 'fujin',
    nameJa: '風神',
    nameEn: 'FUJIN',
    symbol: '🌀',
    attackJa: '疾風連撃',
    attackEn: 'Gale Rush',
    guardJa: '風圧障壁',
    guardEn: 'Wind Barrier',
    specialJa: '蒼嵐旋空',
    specialEn: 'Sōran Senkū',
  },
};

export const BRAND = {
  navy: '#070D1A',
  amber: '#F7931A',
  teal: '#25C8D7',
  offWhite: '#EFF5FF',
} as const;
