import {
  formatClock,
  isCombatPhase,
  PHASE_LABEL,
  REASON_TEXT,
  ROLE_IDS,
  ROLES,
  SEATS,
} from '@swed/shared';
import type { Lang, PublicMatchState, ReasonCode, RoleId, SeatId } from '@swed/shared';
import {
  IconBolt,
  IconCrosshair,
  IconShield,
  IconSignal,
  IconWrench,
  ROLE_VAR,
} from '@swed/ui-tokens';
import { createContext, useContext, type ReactNode } from 'react';

/** Language context: Japanese first, English toggle (spec §3.4). */
export const LangCtx = createContext<{
  lang: Lang;
  L: (ja: string, en: string) => string;
  setLang: (l: Lang) => void;
}>({
  lang: 'ja',
  L: (ja) => ja,
  setLang: () => undefined,
});
export const useL = () => useContext(LangCtx);

export function reasonText(
  code: ReasonCode | undefined,
  L: (ja: string, en: string) => string,
): string {
  if (!code) return '';
  const t = REASON_TEXT[code];
  return L(t.ja, t.en);
}

/** Top band of every phone screen: brand, role, wave clock, link state (ref 06). */
/** Opens the shared-energy sheet from any console header (kept apart from role controls). */
type Listener = () => void;
let pulseOpen = false;
const pulseListeners = new Set<Listener>();
export const pulseUi = {
  get: () => pulseOpen,
  set: (v: boolean) => {
    pulseOpen = v;
    for (const l of pulseListeners) l();
  },
  subscribe: (l: Listener) => {
    pulseListeners.add(l);
    return () => pulseListeners.delete(l);
  },
};

export function PilotHeader({
  s,
  mt,
  seat,
  connected,
}: {
  s: PublicMatchState | undefined;
  mt: number;
  seat: SeatId | null;
  connected: boolean;
}) {
  const { L, lang, setLang } = useL();
  const label = s ? PHASE_LABEL[s.phase] : null;
  const end = s?.combatEndsAt ?? s?.phaseEndsAt ?? null;
  const def = seat ? SEATS[seat] : null;
  return (
    <header className="ph" style={def ? { ['--acc' as string]: ROLE_VAR[def.role] } : undefined}>
      <div className="ph-top">
        {/* On a console the role bar below names the seat; the brand would crowd narrow phones. */}
        {seat ? null : <span className="ph-brand">SATS WARS / PILOT</span>}
        <span className="ph-wave sw-num">{label ? (lang === 'ja' ? label.ja : label.en) : ''}</span>
        <span className="ph-time sw-num">{end !== null ? formatClock(end - mt) : '--:--'}</span>
        {seat && s && isCombatPhase(s.phase) && mt < s.overchargeUntil ? (
          <span className="ph-oc sw-num" title="OVERCHARGE">
            OC {Math.ceil((s.overchargeUntil - mt) / 1000)}s
          </span>
        ) : null}
        {seat && s && isCombatPhase(s.phase) ? (
          <button
            className="ph-pulse"
            onClick={() => pulseUi.set(true)}
            aria-label={L('共有エネルギー', 'Shared energy')}
          >
            <IconBolt size={14} />
            <span>+{s.hints.pulseGain}</span>
          </button>
        ) : null}
        <span
          className={`ph-link ${connected ? 'ok' : 'bad'}`}
          aria-label={connected ? L('接続中', 'Connected') : L('再接続中', 'Reconnecting')}
        >
          <IconSignal size={18} />
        </span>
        <button
          className="ph-lang"
          onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
          aria-label="Language"
        >
          {lang === 'ja' ? 'EN' : 'JA'}
        </button>
      </div>
      {def ? (
        <div className="ph-role">
          <span className="no sw-num">{String(def.no).padStart(2, '0')}</span>
          <span className="nm">{L(ROLES[def.role].labelJa, ROLES[def.role].labelEn)}</span>
          <span className="en">{def.labelEn}</span>
          <span className="part">{L(def.partJa, def.partEn)}</span>
        </div>
      ) : null}
      {seat && s && isCombatPhase(s.phase) ? <LinkBar s={s} mt={mt} seat={seat} /> : null}
    </header>
  );
}

const ROLE_ICON: Record<RoleId, typeof IconBolt> = {
  GUNNER: IconCrosshair,
  DEFENSE: IconShield,
  POWER: IconBolt,
  ENGINEER: IconWrench,
};

/**
 * LINK CHAIN made visible (spec §6.6): which systems are in the live link, how long it stays
 * open, and whether YOUR success right now would extend it (and what that is worth).
 */
export function LinkBar({ s, mt, seat }: { s: PublicMatchState; mt: number; seat: SeatId }) {
  const { L } = useL();
  const role = SEATS[seat].role;
  const link = s.link && s.link.expiresAt > mt ? s.link : null;
  const mineIn = !!link?.roles.includes(role);
  const yours = !!link && !mineIn;
  const n = link?.roles.length ?? 0;
  const bonus =
    role === 'GUNNER'
      ? L(
          `威力+${Math.round(n * s.hints.linkDamagePerRole * 100)}%`,
          `+${Math.round(n * s.hints.linkDamagePerRole * 100)}% damage`,
        )
      : role === 'ENGINEER'
        ? L('修理量アップ', 'bigger repair')
        : role === 'DEFENSE'
          ? L('CHARGE アップ', 'more CHARGE')
          : L('SYNC アップ', 'more SYNC');
  const text = !link
    ? L('LINK — 誰かが成功すると連携が始まる', 'LINK — any success starts a chain')
    : mineIn
      ? L(`LINK ×${n} — ほかの系統の成功を待つ`, `LINK ×${n} — waiting for other systems`)
      : L(`今あなたが成功で LINK ×${n + 1}（${bonus}）`, `Succeed now: LINK ×${n + 1} (${bonus})`);
  return (
    <div className={`link-bar${yours ? ' yours' : ''}${link ? ' live' : ''}`} aria-live="polite">
      <div className="link-roles" aria-hidden>
        {ROLE_IDS.map((r) => {
          const Icon = ROLE_ICON[r];
          const on = !!link?.roles.includes(r);
          return (
            <span
              key={r}
              className={`lr${on ? ' on' : ''}${r === role ? ' me' : ''}`}
              style={{ ['--rc' as string]: ROLE_VAR[r] }}
            >
              <Icon size={14} />
            </span>
          );
        })}
      </div>
      <span className="link-text">{text}</span>
      {link ? (
        <i
          className="link-time"
          style={{ width: `${Math.max(0, ((link.expiresAt - mt) / s.hints.linkWindowMs) * 100)}%` }}
        />
      ) : null}
    </div>
  );
}

export function Gauge({
  label,
  value,
  max,
  accent,
  right,
}: {
  label: string;
  value: number;
  max: number;
  accent?: string;
  right?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="gauge" style={accent ? { ['--acc' as string]: accent } : undefined}>
      <div className="g-row">
        <span>{label}</span>
        <span className="sw-num">{right ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="g-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "LOCK > CHARGE > FIRE": where the pilot is in the role's loop. */
export function Flow({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="flow" aria-label="flow">
      {steps.map((s, i) => (
        <li key={s} className={i === active ? 'on' : i < active ? 'done' : ''}>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function SystemLine({
  text,
  tone,
  connected,
  mt,
  s,
}: {
  text: string;
  tone: 'ok' | 'bad' | 'info';
  connected: boolean;
  mt: number;
  s?: PublicMatchState;
}) {
  const { L } = useL();
  const end = s?.combatEndsAt ?? s?.phaseEndsAt ?? null;
  return (
    <footer className="sysline" role="status" aria-live="polite">
      <div className={`msg ${tone}`}>{text || L('待機中', 'Standing by')}</div>
      <div className="meta">
        <span className={connected ? 'ok' : 'bad'}>
          {connected ? 'CONNECTED' : L('再接続中 RECONNECTING', 'RECONNECTING')}
        </span>
        <span className="sw-num">{end !== null ? formatClock(end - mt) : ''}</span>
      </div>
    </footer>
  );
}

export function Screen({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <main className="screen" style={accent ? { ['--acc' as string]: accent } : undefined}>
      {children}
    </main>
  );
}
