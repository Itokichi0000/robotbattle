import { describe, expect, it } from 'vitest';
import { normalizeEquipped, unlockedCosmeticIds } from './cosmetics';
import { passportCardSvg } from './passportCard';

const base = {
  name: 'ACE',
  rankJa: '新兵',
  rankEn: 'Recruit',
  sorties: 3,
  victories: 1,
  titles: ['初出撃'],
  favoriteSeat: '🛡 防衛',
  equipped: {},
  eventLine: 'btc-tokyo-2026',
  date: '2026-10-29',
  lightning: false,
  locale: 'ja' as const,
};

describe('passport card and cosmetics', () => {
  it('draws a self-contained SVG and escapes every text', () => {
    const svg = passportCardSvg({ ...base, name: '<script>x</script>&"', titles: ['<b>'] });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toMatch(/href=|url\(|<image|<foreignObject/);
    expect(svg).not.toContain('₿');
  });

  it('unlocks follow the career only; locked or wrong-slot items fall back to defaults', () => {
    const none = unlockedCosmeticIds({
      sorties: 0,
      victories: 0,
      rolesDone: 0,
      rank: 0,
      titles: [],
      events: ['dev'],
    });
    expect(none).toEqual(
      expect.arrayContaining([
        'helmet-standard',
        'visor-clear',
        'suit-navy',
        'fx-none',
        'bg-standard',
      ]),
    );
    expect(none).not.toContain('bg-venue');
    const vet = unlockedCosmeticIds({
      sorties: 10,
      victories: 3,
      rolesDone: 4,
      rank: 4,
      titles: ['SHINRAI_FUJIN', 'VETERAN', 'EARTH_DEFENDER'],
      events: ['btc-tokyo-2026'],
    });
    expect(vet).toEqual(expect.arrayContaining(['helmet-legend', 'visor-prism', 'bg-venue']));
    expect(normalizeEquipped({ HELMET: 'helmet-legend', VISOR: 'bg-venue' }, none)).toMatchObject({
      HELMET: 'helmet-standard',
      VISOR: 'visor-clear',
    });
  });
});
