import { ACTION_LABEL, formatClock, PHASE_LABEL, REASON_TEXT } from '@swed/shared';
import type { ActionKind, Lang, PublicMatchState, ReasonCode } from '@swed/shared';
import { IconCrosshair, IconShield, IconSignal, IconWrench } from '@swed/ui-tokens';
import { createContext, useContext } from 'react';

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

export const ACTION_ICON: Record<ActionKind, typeof IconCrosshair> = {
  ATTACK: IconCrosshair,
  DEFEND: IconShield,
  REPAIR: IconWrench,
};

/** CSS colour per action: amber shoots, cyan shields, mint repairs (spec §3.4 tokens). */
export const ACTION_VAR: Record<ActionKind, string> = {
  ATTACK: 'var(--sw-action)',
  DEFEND: 'var(--sw-ally)',
  REPAIR: 'var(--sw-repair)',
};

export function actionName(kind: ActionKind, L: (ja: string, en: string) => string): string {
  return L(ACTION_LABEL[kind].ja, ACTION_LABEL[kind].en);
}

/** What one press does, in plain words. */
export function effectText(
  kind: ActionKind,
  value: number,
  L: (ja: string, en: string) => string,
): string {
  if (kind === 'ATTACK') return L(`ボスに ${value} ダメージ`, `${value} damage to the boss`);
  if (kind === 'DEFEND') return L(`シールド +${value}`, `Shield +${value}`);
  return L(`雷神の装甲 +${value}`, `RAIJIN armour +${value}`);
}

/** Top band: brand, phase, clock, players, link, language. */
export function PilotHeader({
  s,
  mt,
  connected,
}: {
  s: PublicMatchState | undefined;
  mt: number;
  connected: boolean;
}) {
  const { L, lang, setLang } = useL();
  const label = s ? PHASE_LABEL[s.phase] : null;
  const end = s?.phase === 'LOBBY' ? (s.autoStartAt ?? null) : (s?.phaseEndsAt ?? null);
  return (
    <header className="ph">
      <div className="ph-top">
        <span className="ph-brand">SATS WARS</span>
        <span className="ph-wave sw-num">{label ? (lang === 'ja' ? label.ja : label.en) : ''}</span>
        <span className="ph-time sw-num">{end !== null ? formatClock(end - mt) : '--:--'}</span>
        {s ? (
          <span className="ph-crowd sw-num" aria-label={L('参加人数', 'Players')}>
            {s.players}
            {L('人', '')}
          </span>
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
    </header>
  );
}

export function Bar({
  label,
  value,
  max,
  tone,
  right,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'danger' | 'ally' | 'repair';
  right?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`bar ${tone}`}>
      <div className="bar-row">
        <span>{label}</span>
        <span className="sw-num">{right ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="bar-track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
