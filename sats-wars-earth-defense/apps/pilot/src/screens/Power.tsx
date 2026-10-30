import { useStore, useTicker } from '@swed/client';
import { POWER_LANES } from '@swed/shared';
import type { PowerDistribution, PowerLane, PublicMatchState } from '@swed/shared';
import { COLORS, IconBolt } from '@swed/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, Gauge, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * POWER A console (spec §5.5, §9.5): split REACTOR OUTPUT 100 % across weapon / shield /
 * mobility / repair. Big ±5 steps or a one-tap plan, then SEND POWER. The plan is sent
 * against the version it was drawn from; a stale plan is refused, never silently merged.
 */

const LANE_LABEL: Record<PowerLane, { ja: string; en: string; color: string }> = {
  weapon: { ja: '武器系', en: 'WEAPON', color: COLORS.action },
  shield: { ja: 'シールド系', en: 'SHIELD', color: COLORS.ally },
  mobility: { ja: '機動系', en: 'MOBILITY', color: COLORS.text },
  repair: { ja: '修理系', en: 'REPAIR', color: COLORS.repair },
};

const PLANS: Array<{ ja: string; en: string; d: PowerDistribution }> = [
  { ja: '攻撃重視', en: 'ATTACK', d: { weapon: 55, shield: 25, mobility: 5, repair: 15 } },
  { ja: '防御重視', en: 'DEFEND', d: { weapon: 30, shield: 45, mobility: 10, repair: 15 } },
  { ja: '修理重視', en: 'REPAIR', d: { weapon: 30, shield: 30, mobility: 10, repair: 30 } },
  { ja: 'バランス', en: 'BALANCE', d: { weapon: 35, shield: 30, mobility: 15, repair: 20 } },
];

const sum = (d: PowerDistribution) => d.weapon + d.shield + d.mobility + d.repair;
const same = (a: PowerDistribution, b: PowerDistribution) =>
  POWER_LANES.every((l) => a[l] === b[l]);

export function Power() {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(200);
  const s = st.snap?.state as PublicMatchState;
  const mt = store.matchTime(now);
  const [draft, setDraft] = useState<PowerDistribution>(() => ({ ...s.distribution }));
  const lastServer = useRef<PowerDistribution>({ ...s.distribution });
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' }>({
    text: '',
    tone: 'info',
  });
  const max = s.hints.powerLaneMax;

  // A new plan arrived (ours, or AUTO SUPPORT's before we boarded): follow it unless the
  // pilot is in the middle of editing their own.
  const { distribution, distributionVersion } = s;
  useEffect(() => {
    setDraft((d) => (same(d, lastServer.current) ? { ...distribution } : d));
    lastServer.current = { ...distribution };
    // Keyed on the version: the distribution object is new on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distributionVersion]);

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'circuit_overload') {
          haptic(30);
          setMsg({
            text: L(
              `過負荷：${LANE_LABEL[e.lane].ja} の回路が切断`,
              `Overload: ${e.lane} circuit cut`,
            ),
            tone: 'bad',
          });
        }
        if (e.type === 'team_combo')
          setMsg({ text: `LINK ESTABLISHED +${e.gain} SYNC`, tone: 'ok' });
      }),
    [L],
  );

  // Drag along a lane bar to set its share directly (snaps to 5 %, capped per lane).
  const dragTo = (lane: PowerLane, ev: React.PointerEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const v = Math.round((((ev.clientX - r.left) / r.width) * max) / 5) * 5;
    setDraft((d) => ({ ...d, [lane]: Math.max(0, Math.min(max, v)) }));
  };

  const step = (lane: PowerLane, delta: number) => {
    haptic(8);
    setDraft((d) => ({ ...d, [lane]: Math.max(0, Math.min(max, d[lane] + delta)) }));
  };

  const send = async (d: PowerDistribution) => {
    if (pending) return;
    haptic(20);
    setPending(true);
    const r = await sendAction('POWER_CORE', {
      actionType: 'SET_POWER',
      payload: { distribution: d, baseVersion: s.distributionVersion },
    });
    setPending(false);
    if (r.accepted) {
      setMsg({ text: L('出力配分を送信', 'Power plan sent'), tone: 'ok' });
      setDraft({ ...d });
      lastServer.current = { ...d };
    } else {
      setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
      if (r.reasonCode === 'STALE_VERSION') setDraft({ ...s.distribution });
    }
  };

  const total = sum(draft);
  const changed = !same(draft, s.distribution);
  const ok = total === 100 && changed;

  return (
    <div className="console" style={{ ['--acc' as string]: COLORS.power }}>
      <PilotHeader s={s} mt={mt} seat="POWER_CORE" connected={st.connected} />
      <section
        className="viewport sw-frame"
        style={{ ['--sw-frame-accent' as string]: COLORS.power }}
      >
        <div className="vp-k">
          <IconBolt size={16} /> REACTOR OUTPUT 100%
          <span className={`vp-right${total !== 100 ? ' hot' : ''}`}>
            {L('合計', 'TOTAL')} <b className="sw-num">{total}%</b>
          </span>
        </div>
        <div className="lanes">
          {POWER_LANES.map((lane) => {
            const cut = s.circuits[lane].broken;
            return (
              <div
                key={lane}
                className={`lane${cut ? ' cut' : ''}`}
                style={{ ['--lane' as string]: LANE_LABEL[lane].color }}
              >
                <div className="lane-head">
                  <span>
                    {L(LANE_LABEL[lane].ja, LANE_LABEL[lane].en)}
                    {cut ? <em> {L('回路切断', 'CUT')}</em> : null}
                  </span>
                  <span className="sw-num">
                    {draft[lane]}%
                    {draft[lane] !== s.distribution[lane] ? (
                      <small> ({s.distribution[lane]})</small>
                    ) : null}
                  </span>
                </div>
                <div className="lane-ctrl">
                  <button
                    className="step"
                    aria-label={L(
                      `${LANE_LABEL[lane].ja} を5%下げる`,
                      `${LANE_LABEL[lane].en} −5%`,
                    )}
                    onClick={() => step(lane, -5)}
                    disabled={draft[lane] <= 0}
                  >
                    −
                  </button>
                  <div
                    className="lane-bar drag"
                    aria-hidden
                    onPointerDown={(ev) => {
                      ev.currentTarget.setPointerCapture(ev.pointerId);
                      haptic(5);
                      dragTo(lane, ev);
                    }}
                    onPointerMove={(ev) => {
                      if (ev.currentTarget.hasPointerCapture(ev.pointerId)) dragTo(lane, ev);
                    }}
                  >
                    <i style={{ width: `${(draft[lane] / max) * 100}%` }} />
                    <b style={{ width: `${(s.energy[lane] / s.hints.laneMax) * 100}%` }} />
                  </div>
                  <button
                    className="step"
                    aria-label={L(
                      `${LANE_LABEL[lane].ja} を5%上げる`,
                      `${LANE_LABEL[lane].en} +5%`,
                    )}
                    onClick={() => step(lane, 5)}
                    disabled={draft[lane] >= max}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="vp-foot">
          [ ROUTING / GAUGES ]{' '}
          {L(
            'バーをドラッグで配分・細線＝蓄電量',
            'drag a bar to set it · thin line = stored energy',
          )}
        </div>
      </section>
      <Flow steps={['ALLOCATE', 'CONFIRM']} active={changed ? 1 : 0} />
      <div className="plans" role="group" aria-label={L('ワンタップ配分', 'One-tap plans')}>
        {PLANS.map((p) => (
          <button
            key={p.en}
            className={`chip${same(p.d, s.distribution) ? ' on' : ''}`}
            onClick={() => void send(p.d)}
            disabled={pending}
          >
            <span>{L(p.ja, p.en)}</span>
            <small className="sw-num">
              {p.d.weapon}/{p.d.shield}/{p.d.mobility}/{p.d.repair}
            </small>
          </button>
        ))}
      </div>
      <div className="thumb">
        <button className="btn power" disabled={!ok || pending} onClick={() => void send(draft)}>
          <span className="lbl">
            {pending ? L('送信中…', 'Sending…') : L('出力を送る', 'SEND POWER')}
          </span>
          <small>
            {total !== 100
              ? L(`合計を100%に（あと${100 - total}）`, `Make it 100 % (${100 - total} left)`)
              : changed
                ? 'SEND POWER'
                : L('現在の配分', 'Current plan')}
          </small>
        </button>
        <Gauge
          label={L('炉心出力（コア健全度）', 'REACTOR (core health)')}
          value={s.parts.CORE}
          max={100}
          accent={COLORS.power}
        />
      </div>
      <SystemLine text={msg.text} tone={msg.tone} connected={st.connected} mt={mt} s={s} />
    </div>
  );
}
