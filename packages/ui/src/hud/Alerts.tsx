import { useState } from 'react';
import type { Role } from '@sats-wars/shared';
import { ATTACK_LABELS, ENEMY_LABELS, ROLE_LABELS } from '@sats-wars/shared';
import { cityName } from '../board';
import type { RaidLike, RaidView } from '../view';
import { ENEMY_ICON, Icon, ROLE_ICON } from './icons';
import { fmtSecs } from './primitives';

type Lx = (ja: string, en: string) => string;

const DIR_GLYPH = { LEFT: 'left', UP: 'up', RIGHT: 'right' } as const;

/**
 * Warnings (top right, spec 3.2): one primary warning — the attack that lands
 * first — with its target, direction and a countdown bar; the others only as
 * a count. Lethal warnings pulse at 1 Hz. The station the robots need sits
 * underneath.
 */
export function WarningPanel({
  raid,
  view,
  locale,
  gameNow,
  myRole,
}: {
  raid: RaidLike;
  view: RaidView;
  locale: 'ja' | 'en';
  gameNow: number;
  myRole: Role | null;
}) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const tgs = [...raid.telegraphs].sort((a, z) => a.resolvesAt - z.resolvesAt);
  const t = tgs[0];
  const live = raid.status === 'LIVE';
  if (!live) return null;
  return (
    <aside className="hud-warn" aria-live="polite">
      {t ? (
        (() => {
          const e = raid.enemies.find((x) => x.id === t.enemyId) ?? null;
          const secs = Math.max(0, (t.resolvesAt - gameNow) / 1000);
          const total = Math.max(1, (t.resolvesAt - t.startsAt) / 1000);
          const lethal = t.targets.some((c) => view.threats[c]?.lethal);
          return (
            <div
              key={t.id}
              className={`hud-warn-main${lethal ? ' is-lethal' : ''}`}
              role="alert"
              data-testid="threat-line"
            >
              <span className="hud-warn-head">
                <Icon name="warning" size={16} />
                <span className="hud-label">{lethal ? 'CITY CRITICAL' : 'INCOMING'}</span>
                <b className="hud-num hud-warn-count">{fmtSecs(secs)}</b>
              </span>
              <span className="hud-warn-target">
                <Icon name={DIR_GLYPH[t.direction]} size={16} />
                {t.targets.map((c) => cityName(c, L)).join('・')}
              </span>
              <span className="hud-warn-sub">
                <Icon name={e ? ENEMY_ICON[e.kind] : 'hostile'} size={13} />
                {e ? L(ENEMY_LABELS[e.kind].ja, ENEMY_LABELS[e.kind].en) : ''}
                {' · '}
                {L(ATTACK_LABELS[t.kind].ja, ATTACK_LABELS[t.kind].en)}
                {lethal && (
                  <b className="hud-warn-lethal">{L('このままだと陥落', 'city will fall')}</b>
                )}
              </span>
              <span className="hud-warn-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (secs / total) * 100)}%` }} />
              </span>
              {tgs.length > 1 && (
                <span className="hud-warn-more">
                  {L(`ほか ${tgs.length - 1} 件の予兆`, `+${tgs.length - 1} more`)}
                </span>
              )}
            </div>
          );
        })()
      ) : (
        <div className="hud-warn-main is-calm" data-testid="threat-line">
          <span className="hud-warn-head">
            <Icon name="link" size={16} />
            <span className="hud-label">CLEAR</span>
          </span>
          <span className="hud-warn-target is-calm">{L('攻撃予兆なし', 'No incoming attack')}</span>
        </div>
      )}
      <div
        className={`hud-warn-need${view.needed === myRole ? ' is-mine' : ''}`}
        data-testid="needed-station"
      >
        <Icon name={ROLE_ICON[view.needed]} size={14} />
        {view.needed === myRole
          ? L(`あなたの${ROLE_LABELS[view.needed].ja}が必要`, `Your station is needed`)
          : L(`要請：${ROLE_LABELS[view.needed].ja}`, `Needed: ${ROLE_LABELS[view.needed].en}`)}
      </div>
    </aside>
  );
}

export interface CommsItem {
  id: number | string;
  text: string;
  /** Who acted (role icon), when known. */
  role?: Role | null;
  tone?: 'ally' | 'mine' | 'miss' | 'big' | 'ops';
}

/**
 * Operations comms (top left): the latest message only — a crewmate's action,
 * an operator broadcast — with the recent log behind a toggle.
 */
export function CommsPanel({ items, locale }: { items: CommsItem[]; locale: 'ja' | 'en' }) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  return (
    <aside
      className={`hud-comms${open ? ' is-open' : ''}`}
      aria-label={L('作戦通信', 'Operations comms')}
    >
      <button
        type="button"
        className="hud-comms-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={items.length === 0}
      >
        <Icon name="horn" size={14} />
        <span className="hud-label">COMMS</span>
        <span className="hud-num">{items.length}</span>
      </button>
      {open ? (
        <ol className="hud-comms-log" data-testid="comms-log">
          {items.slice(-8).map((m) => (
            <li key={m.id} className={`is-${m.tone ?? 'ally'}`}>
              {m.role && <Icon name={ROLE_ICON[m.role]} size={13} />}
              {m.text}
            </li>
          ))}
        </ol>
      ) : (
        last && (
          <p
            key={last.id}
            className={`hud-comms-last is-${last.tone ?? 'ally'}`}
            role="status"
            data-testid="comms-last"
          >
            {last.role && <Icon name={ROLE_ICON[last.role]} size={13} />}
            {last.text}
          </p>
        )
      )}
    </aside>
  );
}
