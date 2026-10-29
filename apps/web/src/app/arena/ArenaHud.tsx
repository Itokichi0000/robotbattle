'use client';
import type { PublicRaidSnapshot } from '@sats-wars/shared';
import {
  ENEMY_LABELS,
  ONE_LINE_RULES,
  ROLES,
  ROLE_LABELS,
  SATS_EXPLAINER,
} from '@sats-wars/shared';
import type { ArenaDirector, Banner, BannerTone, FrameStats } from '@sats-wars/three-game';
import { CockpitStrip } from '@sats-wars/three-game';
import {
  RaidHeader,
  ResultCard,
  RobotBars,
  type RaidView,
  cityName,
  Icon,
  ROLE_ICON,
} from '@sats-wars/ui';
import { Logo } from '@/components/Logo';
import { QrCode } from '@/components/QrCode';
import type { ConnectionState, RaidConnection } from '@/lib/connection';
import { useI18n } from '@/lib/i18n';
import { ActionPopups } from './Popups';

const TONE_COLOR: Record<BannerTone, string> = {
  ally: '#FFE27A',
  enemy: '#FF3B5C',
  neutral: '#EFF5FF',
  RAIJIN: '#F7931A',
  FUJIN: '#25C8D7',
};

/**
 * Venue HUD over the 3D (or 2D) scene, for people walking past: how to join
 * and the QR are always visible, and the few things that matter (time, the
 * next attack, NULL CORE, which seat is needed) are huge.
 */
export function ArenaHud({
  snap,
  view,
  conn,
  connState,
  banner,
  stats,
  renderer,
  contextLost,
  preview = false,
  director,
}: {
  snap: PublicRaidSnapshot;
  view: RaidView;
  conn: RaidConnection;
  connState: ConnectionState;
  banner: Banner | null;
  stats: FrameStats | null;
  renderer: 'webgl' | '2d';
  contextLost: boolean;
  /** Rehearsal mode: hide status overlays so cinematics stay visible. */
  preview?: boolean;
  /** Seat lamps for the cockpit strip (the 3D/2D director). */
  director?: ArenaDirector;
}) {
  const { locale, L } = useI18n();
  const playUrl =
    snap.playUrl || (typeof window !== 'undefined' ? `${window.location.origin}/play` : '/play');
  const lobby = snap.status === 'LOBBY_OPEN' || snap.status === 'CREATED';
  const lobbyLeft = snap.lobbyEndsAt
    ? Math.max(0, Math.ceil((snap.lobbyEndsAt - Date.now()) / 1000))
    : null;
  const humans = snap.crew.filter((m) => !m.isBot).length;
  const bots = snap.crew.length - humans;
  const showBanner = !!banner;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col p-[1.2vw] text-off"
      data-testid="arena-hud"
    >
      {/* top row */}
      <div className="flex items-start justify-between gap-[1vw]">
        <div className="flex flex-col gap-[0.6vh]">
          <div className="origin-top-left scale-[0.9]">
            <Logo size="md" />
          </div>
          {snap.venueName && (
            <span className="text-[1vw] font-bold text-muted" data-testid="arena-venue">
              📍 {snap.venueName}
            </span>
          )}
          {connState !== 'connected' && (
            <span className="rounded bg-danger/80 px-2 py-1 text-[1vw] font-bold" role="status">
              {connState === 'offline'
                ? L('サーバー未接続', 'Server offline')
                : L('再接続中…', 'Reconnecting…')}
            </span>
          )}
          {/* Left column: the top centre stays clear for NULL CORE above the map. */}
          {!lobby && (
            <div className="w-[27vw] text-[1.1vw]">
              <RaidHeader raid={snap} view={view} locale={locale} />
            </div>
          )}
        </div>
        {/* Always on (spec E3); operators can hide it only on purpose (photo shoots). */}
        {snap.arenaDisplay?.showQr !== false && (
          <JoinCard
            url={playUrl}
            lobby={lobby}
            joinOpen={snap.joinOpen}
            passMode={snap.passMode}
            price={snap.ticketPriceSats}
            demo={snap.demoMode}
          />
        )}
      </div>

      {/* banner */}
      {!preview && showBanner && banner && (
        <div
          className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center"
          data-testid="arena-banner"
        >
          <div
            key={`${banner.kind}-${banner.until}`}
            className="sw-banner-in rounded-2xl bg-black/55 px-[3vw] py-[1.4vh] text-center"
          >
            <div
              className="sw-display text-[4.2vw] leading-tight"
              style={{ color: TONE_COLOR[banner.tone] }}
            >
              {locale === 'ja' ? banner.textJa : banner.textEn}
            </div>
            {(banner.subJa || banner.subEn) && (
              <div className="text-[1.6vw] font-bold">
                {locale === 'ja' ? banner.subJa : banner.subEn}
              </div>
            )}
          </div>
        </div>
      )}

      {/* broadcast */}
      {snap.broadcast && (
        <div
          className="absolute inset-x-[20%] top-[18%] rounded-xl bg-teal/90 px-[1.5vw] py-[1vh] text-center text-[1.8vw] font-black text-navy"
          role="status"
          data-testid="broadcast"
        >
          <Icon name="horn" className="mr-[0.5vw] inline size-[1.4vw] align-[-0.15em]" />
          {L(snap.broadcast.messageJa, snap.broadcast.messageEn)}
        </div>
      )}

      {/* lobby */}
      {lobby && !preview && (
        <div
          className="absolute inset-x-[18%] top-[22%] flex flex-col items-center gap-[1.5vh] rounded-3xl bg-black/60 p-[2vw] text-center"
          data-testid="arena-lobby"
        >
          <h1 className="sw-display text-[3.6vw] leading-tight">
            {L('地球防衛作戦 パイロット募集中！', 'EARTH DEFENSE — pilots wanted!')}
          </h1>
          <p className="text-[1.6vw] font-bold">
            {locale === 'ja' ? ONE_LINE_RULES.ja : ONE_LINE_RULES.en}
          </p>
          <div className="grid grid-cols-4 gap-[1vw] text-[1.3vw]">
            {ROLES.map((r) => (
              <div key={r} className="rounded-xl bg-navy-3/80 px-[0.8vw] py-[1vh]">
                <Icon name={ROLE_ICON[r]} className="mx-auto size-[2.4vw]" />
                <div className="font-black">{L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}</div>
                <div className="text-[1vw] text-muted">
                  {L(ROLE_LABELS[r].doJa, ROLE_LABELS[r].doEn)}
                </div>
                <div className="mt-1 text-[1.1vw]">
                  <Icon name="crew" className="mr-1 inline size-[1.1vw] align-[-0.1em]" />
                  {view.crewByRole[r]}
                </div>
              </div>
            ))}
          </div>
          <p className="sw-display text-[3vw] text-amber" data-testid="arena-lobby-countdown">
            {lobbyLeft !== null
              ? L(`出撃まで ${lobbyLeft}秒`, `Launch in ${lobbyLeft}s`)
              : L('最初のパイロットを待っています', 'Waiting for the first pilot')}
          </p>
          <p className="text-[1.3vw] text-muted">
            {L(`搭乗 ${humans}人`, `${humans} aboard`)}
            {bots > 0 ? L(`＋デモ機 ${bots}`, ` + ${bots} demo bots`) : ''}
          </p>
        </div>
      )}

      {/* live: threats (left) */}
      {snap.status === 'LIVE' && !preview && (
        <div className="mt-[1vh] flex w-[26vw] flex-col gap-[0.6vh]">
          {snap.telegraphs
            .slice()
            .sort((a, b) => a.resolvesAt - b.resolvesAt)
            .slice(0, 4)
            .map((t) => {
              const e = snap.enemies.find((x) => x.id === t.enemyId);
              const secs = Math.max(0, Math.ceil((t.resolvesAt - conn.gameNow()) / 1000));
              const lethal = t.targets.some((c) => view.threats[c]?.lethal);
              return (
                <div
                  key={t.id}
                  className={`rounded-xl px-[1vw] py-[0.6vh] text-[1.35vw] font-bold ${lethal ? 'sw-pulse bg-danger/80' : 'bg-black/55'}`}
                  data-testid="arena-threat"
                >
                  <Icon name="warning" className="mr-[0.4vw] inline size-[1.3vw] align-[-0.15em]" />
                  {e ? L(ENEMY_LABELS[e.kind].ja, ENEMY_LABELS[e.kind].en) : ''} →{' '}
                  {t.targets.map((c) => cityName(c, L)).join('・')}{' '}
                  <span className="tabular-nums">{secs}s</span>
                  {lethal && (
                    <span className="block text-[1vw]">
                      {L('防衛席、シールドを！', 'Guardians, shield it!')}
                    </span>
                  )}
                </div>
              );
            })}
          {view.needed && (
            <div
              className="rounded-xl bg-amber/90 px-[1vw] py-[0.6vh] text-[1.4vw] font-black text-navy"
              data-testid="arena-needed"
            >
              {L('いま必要：', 'Needed now: ')}
              <Icon
                name={ROLE_ICON[view.needed]}
                className="mr-[0.3vw] inline size-[1.4vw] align-[-0.15em]"
              />
              {L(ROLE_LABELS[view.needed].ja, ROLE_LABELS[view.needed].en)}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* bottom row */}
      <div className="flex items-end justify-between gap-[1vw]">
        <ActionPopups conn={conn} locale={locale} />
        {!lobby && snap.status !== 'ENDED' && (
          <div className="flex items-end gap-[1vw]">
            {director && snap.crew.length > 0 && (
              <CockpitStrip crew={snap.crew} director={director} locale={locale} />
            )}
            <div className="w-[30vw] text-[1.1vw]">
              <RobotBars raid={snap} locale={locale} />
            </div>
          </div>
        )}
      </div>

      {/* results */}
      {snap.status === 'ENDED' && snap.result && !preview && (
        <div className="absolute inset-x-[25%] top-[14%] text-[1.3vw]" data-testid="arena-results">
          <ResultCard result={snap.result} locale={locale} bestScore={snap.bestScore} />
          <p className="mt-2 text-center text-[1.3vw] font-bold">
            {L('まもなく次の作戦。QRから搭乗しよう！', 'Next raid soon. Scan the QR to board!')}
          </p>
        </div>
      )}

      {snap.status === 'PAUSED' && (
        <div
          className="absolute inset-x-[30%] top-[45%] rounded-2xl bg-black/70 py-[2vh] text-center text-[2.4vw] font-black"
          role="status"
        >
          ⏸ {L('一時停止中', 'Paused')}
        </div>
      )}

      {(stats || contextLost) && (
        <div
          className="absolute right-2 bottom-2 rounded bg-black/60 px-2 py-1 font-mono text-xs"
          data-testid="arena-stats"
        >
          {renderer} {stats ? `${stats.fps.toFixed(0)}fps ${stats.frameMs.toFixed(1)}ms` : ''}{' '}
          {contextLost ? 'context lost → 2D' : ''}
        </div>
      )}
    </div>
  );
}

function JoinCard({
  url,
  lobby,
  joinOpen,
  passMode,
  price,
  demo,
}: {
  url: string;
  lobby: boolean;
  joinOpen: boolean;
  passMode: 'FREE' | 'PAID';
  price: number;
  demo: boolean;
}) {
  const { L, locale } = useI18n();
  return (
    <div
      className="pointer-events-auto flex flex-col items-center gap-[0.5vh] rounded-2xl bg-black/60 p-[0.8vw]"
      data-testid="join-card"
    >
      <p className="text-[1.3vw] font-black">
        {joinOpen
          ? L('スマホで搭乗', 'Board with your phone')
          : L('次の作戦に搭乗', 'Board the next raid')}
      </p>
      <QrCode
        url={url}
        size={lobby ? 220 : 150}
        caption={lobby}
        label={L('参加用QRコード', 'Join QR code')}
      />
      <p className="text-[1vw] font-bold">
        {/* The pass mode decides (a DEMO_MODE rehearsal can run the paid flow with mock payments). */}
        {passMode === 'FREE'
          ? demo
            ? L('デモ：無料', 'Demo: free')
            : L('今日は無料イベント', 'Free event today')
          : L(`出撃パス ${price} sats（1作戦）`, `Pass ${price} sats per raid`)}
      </p>
      {passMode === 'PAID' && (
        <p className="max-w-[16vw] text-center text-[0.75vw] text-muted">
          {locale === 'ja' ? SATS_EXPLAINER.ja : SATS_EXPLAINER.en}
        </p>
      )}
    </div>
  );
}
