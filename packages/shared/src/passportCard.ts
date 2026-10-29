import {
  COSMETIC_BY_ID,
  DEFAULT_COSMETICS,
  NON_VENUE_EVENT_IDS,
  type CosmeticSlot,
} from './cosmetics';
import { ROLE_LABELS, TITLE_LABELS } from './i18n';
import type { PassportResponse } from './protocol';

/**
 * The shareable pilot license (spec C10: 持ち帰れるデジタルライセンス画像).
 * One SVG generator for both sides: the server serves it at
 * GET /api/passport-card and the passport page turns the same SVG into a PNG
 * to save or share. Self-contained (no fonts, images or links to fetch).
 * Never shows keys, payment data or internal ids — only what the pilot sees
 * on their own passport, and the callsign only if they want it.
 */
export interface PassportCardInput {
  /** Callsign, or the PILOT-xxxxx pseudonym for an anonymous card. */
  name: string;
  rankJa: string;
  rankEn: string;
  sorties: number;
  victories: number;
  /** Title labels already in the card language (up to 4 are drawn). */
  titles: string[];
  /** Most flown seat icon + label, e.g. "🛡 防衛". */
  favoriteSeat: string | null;
  equipped: Partial<Record<CosmeticSlot, string>>;
  /** Latest venue event / venue name, if any. */
  eventLine: string | null;
  /** ISO date (YYYY-MM-DD) printed on the card. */
  date: string;
  lightning: boolean;
  /** Linked npub, only when the pilot chose to print it (never on anonymous cards). */
  npub?: string | null;
  locale: 'ja' | 'en';
}

export const PASSPORT_CARD_SIZE = { width: 1200, height: 630 } as const;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

const pick = (eq: PassportCardInput['equipped'], slot: CosmeticSlot) =>
  COSMETIC_BY_ID[eq[slot] ?? ''] ?? COSMETIC_BY_ID[DEFAULT_COSMETICS[slot]]!;

/** Background motif per license background (original geometric patterns). */
function pattern(bgId: string, accent: string): string {
  switch (bgId) {
    case 'bg-circuit': {
      const lines: string[] = [];
      for (let i = 0; i < 9; i++) {
        const y = 60 + i * 64;
        lines.push(
          `<path d="M640 ${y} h${120 + (i % 3) * 60} l40 32 h${200 - (i % 2) * 80}" fill="none" stroke="${accent}" stroke-opacity="0.22" stroke-width="3"/>`,
          `<circle cx="${800 + (i % 3) * 60 + 240 - (i % 2) * 80}" cy="${y + 32}" r="7" fill="${accent}" fill-opacity="0.35"/>`,
        );
      }
      return lines.join('');
    }
    case 'bg-thunder':
      return [0, 1, 2]
        .map(
          (i) =>
            `<path d="M${760 + i * 130} 20 l-60 180 h70 l-90 220 h80 l-120 210" fill="none" stroke="${accent}" stroke-opacity="${0.18 + i * 0.06}" stroke-width="10" stroke-linejoin="round"/>`,
        )
        .join('');
    case 'bg-venue':
      return (
        [0, 1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<circle cx="${700 + (i % 3) * 170}" cy="${110 + Math.floor(i / 3) * 300}" r="${70 + (i % 2) * 30}" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="6"/>`,
          )
          .join('') +
        `<rect x="0" y="560" width="1200" height="70" fill="${accent}" fill-opacity="0.18"/>`
      );
    default:
      return `<path d="M600 0 L1200 0 L1200 630 L900 630 Z" fill="${accent}" fill-opacity="0.10"/>`;
  }
}

/** Helmeted pilot bust in the equipped colours (no face, no photo: an icon). */
function bust(eq: PassportCardInput['equipped']): string {
  const helmet = pick(eq, 'HELMET');
  const visor = pick(eq, 'VISOR');
  const suit = pick(eq, 'SUIT');
  const fx = pick(eq, 'COCKPIT_FX');
  const crest =
    helmet.id === 'helmet-raijin-horn'
      ? `<path d="M210 150 l-30 -70 l50 50 Z M330 150 l30 -70 l-50 50 Z" fill="${helmet.accent}"/>`
      : helmet.id === 'helmet-fujin-fin'
        ? `<path d="M270 110 q60 -70 110 -40 q-50 10 -70 60 Z" fill="${helmet.accent}"/>`
        : helmet.id === 'helmet-oni-crest' || helmet.id === 'helmet-legend'
          ? `<path d="M230 120 l40 -60 l40 60 Z" fill="${helmet.accent}"/>`
          : `<rect x="262" y="102" width="16" height="40" rx="6" fill="${helmet.accent}"/>`;
  return [
    `<circle cx="270" cy="330" r="190" fill="${fx.color}" fill-opacity="0.16"/>`,
    `<path d="M110 560 q0 -150 160 -170 q160 20 160 170 Z" fill="${suit.color}" stroke="${suit.accent}" stroke-width="6"/>`,
    `<path d="M240 400 h60 v40 h-60 Z" fill="${suit.accent}" fill-opacity="0.7"/>`,
    `<circle cx="270" cy="250" r="118" fill="${helmet.color}" stroke="${helmet.accent}" stroke-width="8"/>`,
    crest,
    `<rect x="182" y="222" width="176" height="64" rx="30" fill="${visor.color}" stroke="${visor.accent}" stroke-width="4"/>`,
    `<path d="M200 236 h70" stroke="${visor.accent}" stroke-opacity="0.8" stroke-width="6" stroke-linecap="round"/>`,
  ].join('');
}

export function passportCardSvg(c: PassportCardInput): string {
  const { width: W, height: H } = PASSPORT_CARD_SIZE;
  const ja = c.locale === 'ja';
  const bg = pick(c.equipped, 'LICENSE_BG');
  const name = esc(c.name.slice(0, 24));
  const titles = c.titles.slice(0, 4).map((t) => esc(t.slice(0, 18)));
  const stat = (x: number, label: string, value: string) =>
    `<g transform="translate(${x} 0)"><text x="0" y="0" font-size="22" fill="#9FB7C9">${esc(label)}</text><text x="0" y="52" font-size="48" font-weight="900" fill="#EFF5FF">${esc(value)}</text></g>`;
  const chips = titles
    .map((t, i) => {
      const w = 40 + t.length * 22;
      const x = 520 + (i % 2) * 300;
      const y = 470 + Math.floor(i / 2) * 50;
      return `<g transform="translate(${x} ${y})"><rect width="${Math.min(w, 280)}" height="40" rx="20" fill="#1B2A44" stroke="${bg.accent}" stroke-width="2"/><text x="18" y="27" font-size="20" font-weight="700" fill="#EFF5FF">🏅 ${t}</text></g>`;
    })
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',system-ui,sans-serif">`,
    `<rect width="${W}" height="${H}" fill="${bg.color}"/>`,
    pattern(bg.id, bg.accent),
    `<rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="28" fill="none" stroke="${bg.accent}" stroke-opacity="0.6" stroke-width="4"/>`,
    bust(c.equipped),
    `<text x="520" y="92" font-size="22" letter-spacing="6" fill="#9FB7C9">SATS WARS · EARTH DEFENSE · PILOT LICENSE</text>`,
    `<text x="520" y="180" font-size="76" font-weight="900" fill="#EFF5FF">${name}</text>`,
    `<text x="520" y="236" font-size="34" font-weight="800" fill="#F7931A">${esc(ja ? c.rankJa : c.rankEn)}</text>`,
    `<g transform="translate(520 300)">`,
    stat(0, ja ? '出撃' : 'Sorties', String(c.sorties)),
    stat(190, ja ? '防衛成功' : 'Victories', String(c.victories)),
    stat(400, ja ? '得意な席' : 'Favourite seat', c.favoriteSeat ?? '—'),
    `</g>`,
    chips,
    // Robots as allies: amber thunder and teal wind emblems (no ₿ marks).
    `<g transform="translate(1040 110)"><circle r="46" fill="#161B20" stroke="#F7931A" stroke-width="6"/><text y="16" text-anchor="middle" font-size="44" font-weight="900" fill="#F7931A">雷</text></g>`,
    `<g transform="translate(1130 170)"><circle r="40" fill="#102836" stroke="#25C8D7" stroke-width="6"/><text y="14" text-anchor="middle" font-size="38" font-weight="900" fill="#25C8D7">風</text></g>`,
    `<text x="520" y="${H - 40}" font-size="20" fill="#9FB7C9">${esc(
      [
        c.eventLine,
        c.date,
        c.lightning ? '⚡ Lightning' : ja ? 'ゲスト' : 'Guest',
        c.npub ? `${c.npub.slice(0, 12)}…${c.npub.slice(-6)}` : null,
      ]
        .filter(Boolean)
        .join('  ·  '),
    )}</text>`,
    `</svg>`,
  ].join('');
}

/**
 * Card data from a passport (same on the server and in the browser).
 * `anonymous` prints the PILOT-xxxxx pseudonym instead of the callsign.
 */
export function passportCardInput(
  p: PassportResponse,
  o: { anonymous: boolean; locale: 'ja' | 'en'; now: number; venueName?: string },
): PassportCardInput {
  const ja = o.locale === 'ja';
  const counts = new Map<string, number>();
  for (const h of p.history) counts.set(h.role, (counts.get(h.role) ?? 0) + 1);
  const fav = [...counts.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] as
    keyof typeof ROLE_LABELS | undefined;
  const venue = p.history.find((h) => !NON_VENUE_EVENT_IDS.has(h.eventId));
  return {
    name: o.anonymous ? p.pilot.pseudonym : p.pilot.callsign,
    rankJa: p.rankNameJa,
    rankEn: p.rankNameEn,
    sorties: p.pilot.sorties,
    victories: p.pilot.victories,
    titles: p.pilot.titles.map((t) =>
      TITLE_LABELS[t] ? (ja ? TITLE_LABELS[t].ja : TITLE_LABELS[t].en) : t,
    ),
    favoriteSeat: fav
      ? `${ROLE_LABELS[fav].icon} ${ja ? ROLE_LABELS[fav].ja : ROLE_LABELS[fav].en}`
      : null,
    equipped: p.pilot.cosmetics.equipped,
    eventLine: venue ? [venue.eventId, o.venueName].filter(Boolean).join(' · ') : null,
    date: new Date(o.now).toISOString().slice(0, 10),
    lightning: p.pilot.lightningLinked,
    npub: !o.anonymous && p.pilot.nostr.showOnCard ? p.pilot.nostr.npub : null,
    locale: o.locale,
  };
}
