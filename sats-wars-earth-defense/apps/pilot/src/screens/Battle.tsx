import { useTicker } from '@swed/client';
import { cityStrike, nowLine } from '@swed/game-engine';
import { ACTION_KINDS, CITIES, isCombatPhase } from '@swed/shared';
import type { ActionKind, PublicMatchState } from '@swed/shared';
import { IconBolt, IconWarning } from '@swed/ui-tokens';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { haptic, loadQuote, openPay, paymentsStore, sendAction } from '../net';
import { ACTION_ICON, ACTION_VAR, actionName, Bar, effectText, reasonText, useL } from '../ui';

/**
 * The whole game on one phone screen (D-033): three big buttons.
 *   tap  = the free, small version (once every ~0.7 s)
 *   ⚡    = the same action, big, for 21 sats (opens a confirm sheet; never one tap)
 * The button that helps most right now is lit, with the reason above it.
 */

interface Pop {
  id: number;
  kind: ActionKind;
  text: string;
}

export function Battle({ s, mt }: { s: PublicMatchState; mt: number }) {
  const { L } = useL();
  const pay = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const [readyAt, setReadyAt] = useState(0);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [mine, setMine] = useState<Record<ActionKind, number>>({ ATTACK: 0, DEFEND: 0, REPAIR: 0 });
  const busy = useRef(false);
  const popId = useRef(0);
  const now = useTicker(100);
  const live = isCombatPhase(s.phase) && !s.paused;
  const line = nowLine(s, mt);
  const strike = cityStrike(s);
  const boss = s.boss;
  const cooling = now < readyAt;
  const coolPct = cooling ? Math.min(100, ((readyAt - now) / s.hints.freeCooldownMs) * 100) : 0;

  useEffect(() => {
    if (live) void loadQuote();
  }, [live, s.matchId]);

  const press = async (kind: ActionKind) => {
    if (!live || busy.current || performance.now() < readyAt) return;
    busy.current = true;
    haptic(10);
    const r = await sendAction(kind);
    busy.current = false;
    if (r.accepted) {
      setReadyAt(performance.now() + s.hints.freeCooldownMs);
      setMine((m) => ({ ...m, [kind]: m[kind] + 1 }));
      const id = ++popId.current;
      setPops((p) => [...p.slice(-4), { id, kind, text: `+${s.hints.free[kind]}` }]);
      setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 900);
      setMsg(null);
    } else if (r.reasonCode === 'COOLDOWN') {
      setReadyAt(performance.now() + 250);
    } else {
      setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
    }
  };

  const q = pay.quote;
  const paidLeft = q ? q.remaining : s.hints.paidPerPilot;
  const paidOff = !q?.enabled || paidLeft <= 0 || !live;

  return (
    <main className="screen battle">
      <section className="status">
        {boss ? (
          <Bar
            label="NULL CORE"
            value={boss.hp}
            max={boss.maxHp}
            tone="danger"
            right={`${Math.round((boss.hp / boss.maxHp) * 100)}%`}
          />
        ) : null}
        <div className="status-row">
          <Bar
            label={L('雷神の装甲', 'RAIJIN armour')}
            value={s.mechHp}
            max={s.mechMax}
            tone="repair"
          />
          <Bar
            label={L('シールド', 'Shield')}
            value={s.shield}
            max={s.shieldMax}
            tone="ally"
            right={strike ? `${s.shield} / ${strike.damage}` : String(s.shield)}
          />
        </div>
      </section>

      <div
        className={`now-call ${line.action.toLowerCase()}${strike && line.action === 'DEFEND' ? ' alarm' : ''}`}
        role="status"
        aria-live="polite"
        style={{ ['--acc' as string]: ACTION_VAR[line.action] }}
      >
        {strike && line.action === 'DEFEND' ? <IconWarning size={22} /> : null}
        <span>
          {live
            ? L(line.ja, line.en)
            : s.paused
              ? L('一時停止中', 'Paused')
              : L(
                  'まもなく戦闘開始。光るボタンを押そう',
                  'Battle starts soon. Press the lit button',
                )}
        </span>
      </div>

      <div className="actions">
        {ACTION_KINDS.map((kind) => {
          const Icon = ACTION_ICON[kind];
          const rec = live && line.action === kind;
          return (
            <div
              key={kind}
              className={`act${rec ? ' rec' : ''}`}
              style={{ ['--acc' as string]: ACTION_VAR[kind] }}
            >
              <button
                className="act-free"
                disabled={!live}
                onClick={() => void press(kind)}
                aria-label={`${actionName(kind, L)} ${effectText(kind, s.hints.free[kind], L)}`}
              >
                <i className="cool" style={{ width: `${coolPct}%` }} aria-hidden />
                <Icon size={30} />
                <span className="act-name">{actionName(kind, L)}</span>
                <span className="act-what">
                  {effectText(kind, s.hints.free[kind], L)}
                  <small>{L('タップ・無料', 'tap · free')}</small>
                </span>
                {rec ? <em className="act-tag">{L('いまこれ', 'NOW')}</em> : null}
                {pops
                  .filter((p) => p.kind === kind)
                  .map((p) => (
                    <b key={p.id} className="pop sw-num" aria-hidden>
                      {p.text}
                    </b>
                  ))}
              </button>
              <button
                className="act-paid"
                disabled={paidOff}
                onClick={() => openPay(kind)}
                aria-label={L(
                  `${s.hints.paidAmountSats} sats で大きく${actionName(kind, L)}`,
                  `Big ${actionName(kind, L)} for ${s.hints.paidAmountSats} sats`,
                )}
              >
                <IconBolt size={20} />
                <span className="sw-num">{s.hints.paidAmountSats} sats</span>
                <small className="sw-num">
                  {kind === 'ATTACK' ? '' : '+'}
                  {s.hints.paid[kind]}
                </small>
              </button>
            </div>
          );
        })}
      </div>

      <footer className="mine" role="status">
        {msg ? (
          <span className={msg.tone === 'bad' ? 'err' : ''}>{msg.text}</span>
        ) : (
          <span>
            {L('あなた', 'You')}: {actionName('ATTACK', L)} {mine.ATTACK} ·{' '}
            {actionName('DEFEND', L)} {mine.DEFEND} · {actionName('REPAIR', L)} {mine.REPAIR}
          </span>
        )}
        <span className="sw-num">
          <IconBolt size={14} /> {L(`あと ${paidLeft} 回`, `${paidLeft} left`)}
        </span>
      </footer>
      {strike && strike.target.type === 'CITY' && live ? (
        <p className="fine">
          {L(
            `${CITIES[strike.target.cityId].nameJa}を守るには、着弾までにシールド ${strike.damage}`,
            `To save ${CITIES[strike.target.cityId].nameEn}: shield ${strike.damage} by impact`,
          )}
        </p>
      ) : null}
    </main>
  );
}
