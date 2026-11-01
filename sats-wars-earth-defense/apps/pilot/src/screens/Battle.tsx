import { useTicker } from '@swed/client';
import { phoneJob, squadStrike } from '@swed/game-engine';
import { isCombatPhase, routeProgress, SQUADS, TEAM_LABEL, ZONES, zoneAt } from '@swed/shared';
import type { ActionKind, PublicMatchState } from '@swed/shared';
import { IconBolt, IconWarning } from '@swed/ui-tokens';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { haptic, loadQuote, openPay, paymentsStore, sendAction, sessionStore } from '../net';
import { ACTION_ICON, ACTION_VAR, Bar, effectText, reasonText, useL } from '../ui';
import { Arena } from './Arena';

/**
 * The battle on a phone (D-035): your team's own screen. Gunners shoot drones, guards knock
 * missiles away from the squad under attack, engineers fix sparks on RAIJIN; when your own
 * job is done (or a job has nobody), the screen switches to what helps. Lightning is one
 * button: everyone gets THUNDER MODE and you throw the bolt.
 */

/** A job screen stays at least this long, so the field does not flicker between jobs. */
const MIN_MODE_MS = 1_800;

export function Battle({ s, mt }: { s: PublicMatchState; mt: number }) {
  const { L } = useL();
  const pay = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const [readyAt, setReadyAt] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const [pop, setPop] = useState<{ id: number; text: string } | null>(null);
  const mode = useRef<{ job: ActionKind; since: number }>({ job: 'ATTACK', since: 0 });
  const now = useTicker(100);
  const live = isCombatPhase(s.phase) && !s.paused;
  const team = session.status?.team ?? 'ATTACK';
  const jobs = session.status?.jobs?.length ? session.status.jobs : [team];
  const strike = squadStrike(s);
  const fever = s.feverUntil > mt;
  const zone = ZONES[zoneAt(routeProgress(s, s.hints.battleMs, mt))];

  // Pick the screen: an urgent job first, then your team's, else shoot (with hysteresis).
  const want = phoneJob(s, mt, jobs);
  if (want !== mode.current.job && now - mode.current.since > MIN_MODE_MS)
    mode.current = { job: want, since: now };
  const job = mode.current.job;

  useEffect(() => {
    if (live) void loadQuote();
  }, [live, s.matchId]);

  /** What one hit is worth right now (short-handed team bonus and THUNDER MODE included). */
  const worth = (kind: ActionKind) =>
    Math.round(
      s.hints.free[kind] * s.hints.teamScale[kind] * (fever ? s.hints.feverMultiplier : 1),
    );

  const onHit = async (kind: ActionKind) => {
    haptic(10);
    setReadyAt(performance.now() + s.hints.freeCooldownMs);
    const r = await sendAction(kind);
    if (r.accepted) {
      setHits((n) => n + 1);
      const v = worth(kind);
      setPop({ id: now, text: kind === 'ATTACK' ? `-${v}` : `+${v}` });
      setMsg(null);
    } else if (r.reasonCode === 'COOLDOWN') {
      setReadyAt(performance.now() + 250);
    } else {
      setMsg(reasonText(r.reasonCode, L));
    }
  };

  const q = pay.quote;
  const paidLeft = q ? q.remaining : s.hints.paidPerPilot;
  const paidOff = !q?.enabled || paidLeft <= 0 || !live;
  const target = strike && strike.target.type === 'SQUAD' ? SQUADS[strike.target.squadId] : null;
  const secs = strike ? Math.max(0, (strike.impactAt - mt) / 1000) : 0;
  const Icon = ACTION_ICON[job];

  const call =
    job === 'DEFEND'
      ? target
        ? L(
            `${target.nameJa}にミサイル！ ${secs.toFixed(0)}秒 — タップで弾け`,
            `Missiles at ${target.nameEn}! ${secs.toFixed(0)}s — tap them away`,
          )
        : L('ミサイルをタップで弾け', 'Tap the missiles away')
      : job === 'REPAIR'
        ? L('雷神の火花をタップして直せ', 'Tap the sparks to fix RAIJIN')
        : L('敵機をタップで撃ち落とせ', 'Tap the drones to shoot them down');

  return (
    <main className={`screen battle team-${team.toLowerCase()}${fever ? ' fever' : ''}`}>
      <section className="status">
        {s.boss ? (
          <Bar
            label={L(`母艦 NULL CORE — ${zone.nameJa}`, `MOTHERSHIP — ${zone.nameEn}`)}
            value={s.boss.hp}
            max={s.boss.maxHp}
            tone="danger"
            right={`${Math.round((s.boss.hp / s.boss.maxHp) * 100)}%`}
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
        className={`job-call${job === 'DEFEND' && target ? ' alarm' : ''}`}
        style={{ ['--acc' as string]: ACTION_VAR[job] }}
        role="status"
        aria-live="polite"
      >
        <span className="job-team">
          <Icon size={18} />
          {L(TEAM_LABEL[team].ja, TEAM_LABEL[team].en)}
          {job !== team ? <em>{L('応援中', 'helping')}</em> : null}
        </span>
        <b>
          {job === 'DEFEND' && target ? <IconWarning size={18} /> : null}
          {live
            ? call
            : s.paused
              ? L('一時停止中', 'Paused')
              : L('まもなく戦闘開始', 'Battle starts soon')}
        </b>
      </div>

      <div className="arena-wrap" style={{ ['--acc' as string]: ACTION_VAR[job] }}>
        <Arena
          mode={job}
          live={live}
          fever={fever}
          readyAt={readyAt}
          baseLabel={target ? L(target.nameJa, target.nameEn) : L('仲間の部隊', 'Allied squad')}
          onHit={(k) => void onHit(k)}
        />
        {pop ? (
          <b key={pop.id} className="arena-pop sw-num" aria-hidden>
            {pop.text}
          </b>
        ) : null}
        {fever ? (
          <div className="fever-tag" role="status">
            <IconBolt size={18} />
            {L(
              `雷モード ×${s.hints.feverMultiplier} — あと ${Math.ceil((s.feverUntil - mt) / 1000)}秒`,
              `THUNDER ×${s.hints.feverMultiplier} — ${Math.ceil((s.feverUntil - mt) / 1000)}s`,
            )}
          </div>
        ) : null}
      </div>

      <div className="thunder-row">
        <button
          className="thunder"
          disabled={paidOff}
          onClick={() => openPay()}
          aria-label={L(
            `${s.hints.paidAmountSats} sats で雷を呼ぶ`,
            `Call the thunder for ${s.hints.paidAmountSats} sats`,
          )}
        >
          <IconBolt size={26} />
          <span>
            <b>{L('雷を呼ぶ', 'CALL THE THUNDER')}</b>
            <small>
              {L(
                `全員${s.hints.feverMultiplier}倍＋あなたが雷を落とす`,
                `Everyone ×${s.hints.feverMultiplier} + you throw the bolt`,
              )}
            </small>
          </span>
          <span className="sats sw-num">{s.hints.paidAmountSats} sats</span>
        </button>
      </div>

      <footer className="mine" role="status">
        {msg ? (
          <span className="err">{msg}</span>
        ) : (
          <span>
            {L('あなたの命中', 'Your hits')}: <b className="sw-num">{hits}</b> ·{' '}
            {effectText(job, worth(job), L)}
          </span>
        )}
        <span className="sw-num">
          <IconBolt size={14} /> {L(`あと ${paidLeft} 回`, `${paidLeft} left`)}
        </span>
      </footer>
    </main>
  );
}
