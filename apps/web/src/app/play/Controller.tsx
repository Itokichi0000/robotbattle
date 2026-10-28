'use client';
import { useRef, useState } from 'react';
import type {
  ActionResponse,
  ActionResult,
  ActionType,
  GameConfig,
  PublicMatchSnapshot,
  RegionId,
  RegionState,
} from '@sats-wars/shared';
import {
  ACTION_CODE_LABELS,
  REGION_INFO,
  REGION_KIND_META,
  TEAM_META,
  eventMessage,
  formatClock,
  otherTeam,
  regionKindDescription,
} from '@sats-wars/shared';
import { JapanMap2D } from '@/components/JapanMap2D';
import { RobotGauge, TeamBadge } from '@/components/TeamBits';
import { ApiError, api, newClientActionId } from '@/lib/api';
import type { MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { actionHint } from './actions';
import type { Me } from './PlayApp';
import type { PlaySession } from './session';

interface Pending {
  type: ActionType;
  regionId: RegionId | null;
}

export function Controller({
  snap,
  conn,
  session,
  me,
  onMe,
  refreshMe,
}: {
  snap: PublicMatchSnapshot;
  conn: MatchConnection;
  session: PlaySession;
  me: Me;
  onMe: (m: Me) => void;
  refreshMe: () => Promise<void>;
}) {
  const { L, locale } = useI18n();
  useTicker(250);
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<{ result: ActionResult; error?: string } | null>(null);
  const sendingRef = useRef(false);
  const myTeam = session.teamId;
  const enemy = otherTeam(myTeam);
  const { gameMs } = conn.now();
  const cfg = snap.config;
  const ap = me.apRemaining;
  const live = snap.status === 'LIVE';
  const paused = snap.status === 'PAUSED';
  const lobby = snap.status === 'LOBBY' || (paused && snap.pausedFrom === 'LOBBY');

  // Show the newest public event as a toast line.
  const lastEvent = snap.recentEvents[snap.recentEvents.length - 1];
  const lastMsg = lastEvent ? eventMessage(lastEvent, locale) : null;

  const submit = async () => {
    if (!pending || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const clientActionId = newClientActionId();
    const body = { clientActionId, type: pending.type, regionId: pending.regionId };
    try {
      let res: ActionResponse | null = null;
      // One automatic retry with the SAME clientActionId: safe because the server is idempotent.
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await api<ActionResponse>('/api/actions', { token: session.token, body });
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'NETWORK' || attempt === 1) throw e;
        }
      }
      if (res) {
        setLast({ result: res.result });
        onMe({ ...me, apRemaining: res.apRemaining });
      }
    } catch (e) {
      setLast({
        result: {
          ok: false,
          code: 'MATCH_NOT_LIVE',
          actionType: pending.type,
          regionId: pending.regionId,
          apBefore: ap,
          apAfter: ap,
          atGameMs: gameMs,
        },
        error: e instanceof ApiError ? e.message : String(e),
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
      setPending(null);
      void refreshMe();
    }
  };

  const nextClashIn = snap.nextClash ? snap.nextClash.atGameMs - gameMs : null;
  const timeLeft = cfg.actionCloseMs - gameMs;
  const region = (id: RegionId) => snap.regions.find((r) => r.regionId === id)!;
  const chargeDisabled = !live || ap <= 0 || snap.teams[myTeam].energy >= cfg.energyMax;

  return (
    <div className="flex flex-col gap-3 pb-24">
      {/* Status strip */}
      <section
        className="sw-panel flex items-center justify-between gap-2 p-3"
        style={{ borderColor: TEAM_META[myTeam].color }}
      >
        <div>
          <TeamBadge teamId={myTeam} locale={locale} className="text-lg" />
          <p className="mt-1 max-w-[9rem] truncate text-xs text-off/70">{me.nickname}</p>
        </div>
        <div className="text-center" aria-label={`AP ${ap}`}>
          <div className="text-xs font-bold text-off/70">AP</div>
          <div className="flex gap-1" data-testid="ap">
            {Array.from({ length: me.apTotal }, (_, i) => (
              <span
                key={i}
                className={`h-5 w-5 rounded-full border-2 ${i < ap ? 'border-yellow-300 bg-yellow-300' : 'border-white/30'}`}
              />
            ))}
          </div>
          <div className="text-xs font-black tabular-nums">
            {ap}/{me.apTotal}
          </div>
        </div>
        <div className="text-right">
          {lobby ? (
            <>
              <div className="text-xs text-off/70">{L('開始まで', 'Starts in')}</div>
              <div className="text-2xl font-black tabular-nums">
                {snap.liveStartClock !== null ? formatClock(-gameMs) : '--:--'}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-off/70">{L('次の激突', 'Next clash')}</div>
              <div className="text-2xl font-black tabular-nums" data-testid="next-clash">
                {nextClashIn !== null ? formatClock(nextClashIn) : '--'}
              </div>
              <div className="text-[11px] text-off/60">
                {L('残り', 'Left')} {formatClock(timeLeft)}
              </div>
            </>
          )}
        </div>
      </section>

      {paused && (
        <div
          className="rounded-lg bg-yellow-400/20 px-3 py-2 text-center font-bold text-yellow-200"
          role="status"
        >
          {L(
            '一時停止中です。APは失われません。再開までお待ちください。',
            'Paused. Your AP is safe. Please wait.',
          )}
        </div>
      )}
      {lobby && (
        <div className="sw-panel p-4 text-center" data-testid="waiting">
          <p className="text-lg font-black">
            {L('参加確定！まもなく試合開始', 'You are in! The match starts soon')}
          </p>
          <p className="mt-1 text-sm text-off/80">
            {L(
              '開始後に地域を選んでアクションできます。会場スクリーンを見てね。',
              'After the start, pick regions and act. Watch the big screen!',
            )}
          </p>
        </div>
      )}

      {/* Robots */}
      <section className="sw-panel grid grid-cols-2 gap-3 p-3">
        <RobotGauge
          team={snap.teams.RAIJIN}
          hp={snap.teams.RAIJIN.hp}
          hpMax={cfg.hpMax}
          energyMax={cfg.energyMax}
          specialThreshold={cfg.specialThreshold}
          locale={locale}
          size="sm"
        />
        <RobotGauge
          team={snap.teams.FUJIN}
          hp={snap.teams.FUJIN.hp}
          hpMax={cfg.hpMax}
          energyMax={cfg.energyMax}
          specialThreshold={cfg.specialThreshold}
          locale={locale}
          size="sm"
          align="right"
        />
      </section>

      {last && (
        <div
          className={`rounded-lg px-3 py-2 font-bold ${last.result.ok ? 'bg-ok/20 text-ok' : 'bg-danger/15 text-danger'}`}
          role="status"
          aria-live="assertive"
          data-testid="last-result"
        >
          {last.error ?? ACTION_CODE_LABELS[last.result.code][locale]}
          {last.result.ok && <span className="ml-2 text-off/80">AP {last.result.apAfter}</span>}
          {!last.result.ok && !last.error && (
            <span className="ml-2 text-xs text-off/70">
              {L('（APは消費されていません）', '(no AP used)')}
            </span>
          )}
        </div>
      )}
      {lastMsg && <p className="truncate text-center text-xs text-off/70">📣 {lastMsg.text}</p>}

      {/* Regions */}
      <div className="flex gap-2" role="tablist">
        {(['list', 'map'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`sw-focus flex-1 rounded-lg py-2 font-bold ${tab === t ? 'bg-white/15' : 'bg-black/30 text-off/70'}`}
          >
            {t === 'list' ? L('地域リスト', 'Region list') : L('地図', 'Map')}
          </button>
        ))}
      </div>

      {tab === 'map' && (
        <div className="sw-panel p-2">
          <JapanMap2D
            regions={snap.regions}
            locale={locale}
            myTeam={myTeam}
            selected={selected}
            onSelect={setSelected}
            gameMs={gameMs}
            className="mx-auto h-[360px] w-full"
          />
          {selected ? (
            <RegionRow
              config={cfg}
              r={region(selected)}
              myTeam={myTeam}
              enemy={enemy}
              gameMs={gameMs}
              disabled={!live || ap <= 0}
              onPick={setPending}
              expanded
            />
          ) : (
            <p className="p-2 text-center text-sm text-off/70">
              {L('地域をタップして選択', 'Tap a region')}
            </p>
          )}
        </div>
      )}

      {tab === 'list' && (
        <ul className="flex flex-col gap-2" data-testid="region-list">
          {snap.regions.map((r) => (
            <li key={r.regionId}>
              <RegionRow
                config={cfg}
                r={r}
                myTeam={myTeam}
                enemy={enemy}
                gameMs={gameMs}
                disabled={!live || ap <= 0}
                onPick={setPending}
                expanded={selected === r.regionId}
                onToggle={() => setSelected(selected === r.regionId ? null : r.regionId)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Sticky charge button */}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl bg-gradient-to-t from-navy via-navy/95 to-transparent px-3 pb-3 pt-6">
        <button
          className="sw-btn w-full bg-yellow-300 py-4 text-lg text-navy"
          disabled={chargeDisabled}
          onClick={() => setPending({ type: 'CHARGE', regionId: null })}
          data-testid="charge"
        >
          ◆ {L('充電（エネルギー+10）', 'Charge (+10 energy)')}
          <span className="ml-2 text-sm">
            EN {snap.teams[myTeam].energy}/{cfg.energyMax}
          </span>
        </button>
        {ap <= 0 && live && (
          <p className="mt-1 text-center text-xs text-off/70">
            {L('APを使い切りました。会場で応援しよう！', 'All AP used. Cheer on your team!')}
          </p>
        )}
      </div>

      {pending && (
        <ConfirmSheet
          pending={pending}
          sending={sending}
          onConfirm={submit}
          onCancel={() => setPending(null)}
          regionLabel={
            pending.regionId
              ? L(REGION_INFO[pending.regionId].labelJa, REGION_INFO[pending.regionId].labelEn)
              : null
          }
          hint={
            pending.regionId && pending.type !== 'CHARGE'
              ? actionHint(pending.type, region(pending.regionId), myTeam)
              : null
          }
        />
      )}
    </div>
  );
}

function RegionRow({
  r,
  myTeam,
  enemy,
  gameMs,
  disabled,
  onPick,
  expanded,
  onToggle,
  config,
}: {
  config: GameConfig;
  r: RegionState;
  myTeam: 'RAIJIN' | 'FUJIN';
  enemy: 'RAIJIN' | 'FUJIN';
  gameMs: number;
  disabled: boolean;
  onPick: (p: Pending) => void;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const { L, locale } = useI18n();
  const info = REGION_INFO[r.regionId];
  const kind = REGION_KIND_META[r.kind];
  const owner = r.ownerTeamId;
  const status =
    owner === null
      ? { ja: '中立', en: 'Neutral', cls: 'bg-white/15 text-off' }
      : owner === myTeam
        ? { ja: '味方', en: 'Ally', cls: 'text-navy' }
        : { ja: '敵', en: 'Enemy', cls: 'text-navy' };
  const contestLeft =
    r.contestedUntil !== null ? Math.max(0, Math.ceil((r.contestedUntil - gameMs) / 1000)) : 0;
  const attack = actionHint('ATTACK', r, myTeam);
  const defend = actionHint('DEFEND', r, myTeam);
  return (
    <div
      className="sw-panel overflow-hidden"
      data-testid={`region-${r.regionId}`}
      style={{ borderColor: owner ? TEAM_META[owner].color : undefined }}
    >
      <button
        className="sw-focus flex w-full items-center gap-3 p-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="text-2xl" aria-hidden>
          {kind.icon}
        </span>
        <span className="flex-1">
          <span className="block text-lg font-black">{L(info.labelJa, info.labelEn)}</span>
          <span className="block text-xs text-off/70">
            {L(kind.labelJa, kind.labelEn)}・{regionKindDescription(r.kind, config, locale)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-black ${status.cls}`}
            style={owner ? { background: TEAM_META[owner].color } : undefined}
          >
            {owner ? `${TEAM_META[owner].symbol} ` : ''}
            {L(status.ja, status.en)}
          </span>
          {r.contestedByTeamId && (
            <span className="rounded-full bg-yellow-300 px-2 py-0.5 text-xs font-black text-navy sw-pulse">
              {r.contestedByTeamId === enemy
                ? L('敵が争奪中', 'Enemy contest')
                : L('味方が争奪中', 'Our contest')}{' '}
              {contestLeft}s
            </span>
          )}
          {r.shieldCharges > 0 && (
            <span className="text-xs font-bold">🛡 {L('シールド', 'Shield')}</span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <ActionButton
            label={L('⚔ 攻撃', '⚔ Attack')}
            hint={attack}
            disabled={disabled || !attack.enabled}
            onClick={() => onPick({ type: 'ATTACK', regionId: r.regionId })}
            cls="bg-danger text-white"
            testId={`attack-${r.regionId}`}
          />
          <ActionButton
            label={L('🛡 防御', '🛡 Defend')}
            hint={defend}
            disabled={disabled || !defend.enabled}
            onClick={() => onPick({ type: 'DEFEND', regionId: r.regionId })}
            cls="bg-teal text-navy"
            testId={`defend-${r.regionId}`}
          />
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  hint,
  disabled,
  onClick,
  cls,
  testId,
}: {
  label: string;
  hint: { ja: string; en: string };
  disabled: boolean;
  onClick: () => void;
  cls: string;
  testId: string;
}) {
  const { L } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <button
        className={`sw-btn w-full py-3 text-lg ${cls}`}
        disabled={disabled}
        onClick={onClick}
        data-testid={testId}
      >
        {label}
      </button>
      <span className="text-[11px] leading-tight text-off/70">{L(hint.ja, hint.en)}</span>
    </div>
  );
}

function ConfirmSheet({
  pending,
  sending,
  onConfirm,
  onCancel,
  regionLabel,
  hint,
}: {
  pending: Pending;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  regionLabel: string | null;
  hint: { ja: string; en: string } | null;
}) {
  const { L } = useI18n();
  const verb =
    pending.type === 'ATTACK'
      ? L('攻撃', 'Attack')
      : pending.type === 'DEFEND'
        ? L('防御', 'Defend')
        : L('充電', 'Charge');
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={L('確認', 'Confirm')}
    >
      <div className="sw-panel m-3 w-full max-w-xl p-4">
        <p className="text-xl font-black">
          {regionLabel
            ? L(`${regionLabel}を${verb}しますか？`, `${verb} ${regionLabel}?`)
            : L(`${verb}しますか？`, `${verb}?`)}
        </p>
        {hint && <p className="mt-1 text-sm text-off/80">{L(hint.ja, hint.en)}</p>}
        <p className="mt-1 text-sm text-off/70">
          {L('成功するとAPを1消費します。', 'Uses 1 AP if it succeeds.')}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="sw-btn bg-white/10 py-3" onClick={onCancel} disabled={sending}>
            {L('やめる', 'Cancel')}
          </button>
          <button
            className="sw-btn bg-amber py-3 text-lg text-navy"
            onClick={onConfirm}
            disabled={sending}
            data-testid="confirm"
          >
            {sending ? L('送信中…', 'Sending…') : L('実行！', 'Go!')}
          </button>
        </div>
      </div>
    </div>
  );
}
