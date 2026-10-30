import { formatClock, isCombatPhase, PHASE_LABEL, REASON_TEXT, ROLES, SEATS } from '@swed/shared';
import type { Lang, PublicMatchState, ReasonCode, SeatId } from '@swed/shared';
import { IconBolt, IconSignal, ROLE_VAR } from '@swed/ui-tokens';
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
    </header>
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
