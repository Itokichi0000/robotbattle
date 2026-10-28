'use client';
import type { PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import { RESULT_REASON_LABELS, STATUS_LABELS, TEAM_META, formatClock } from '@sats-wars/shared';
import type { Banner, FrameStats } from '@sats-wars/three-game';
import { EventFeed } from '@/components/EventFeed';
import { Logo } from '@/components/Logo';
import { QrCode } from '@/components/QrCode';
import { RobotGauge } from '@/components/TeamBits';
import type { ConnectionState, MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Venue HUD layered over the 3D (or 2D) scene. Readable from the back of a hall. */
export function ArenaHud({
  snap,
  conn,
  connState,
  displayHp,
  banner,
  stats,
  renderer,
  contextLost,
}: {
  snap: PublicMatchSnapshot;
  conn: MatchConnection;
  connState: ConnectionState;
  displayHp: Record<TeamId, number>;
  banner: Banner | null;
  stats: FrameStats | null;
  renderer: 'webgl' | '2d';
  contextLost: boolean;
}) {
  const { locale } = useI18n();
  useTicker(250);
  const { gameMs } = conn.now();
  const cfg = snap.config;
  const live = snap.status === 'LIVE';
  const lobby = snap.status === 'LOBBY';
  const timeLeft = Math.max(0, cfg.actionCloseMs - gameMs);
  const nextClashIn = snap.nextClash && live ? snap.nextClash.atGameMs - gameMs : null;
  const playUrl =
    snap.playUrl || (typeof window !== 'undefined' ? `${window.location.origin}/play` : '/play');
  const J = (ja: string, en: string) => (
    <>
      {ja}
      <span className="ml-2 text-[0.55em] font-bold opacity-70">{en}</span>
    </>
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col p-[1.2vw] text-off"
      style={{ fontSize: 'clamp(12px, 1.05vw, 26px)' }}
    >
      {/* Top bar */}
      <div className="flex items-start gap-[1.5vw]">
        <div className="w-[36%] rounded-2xl bg-black/45 p-[0.8vw] ring-1 ring-white/10 backdrop-blur-sm">
          <RobotGauge
            team={snap.teams.RAIJIN}
            hp={displayHp.RAIJIN}
            hpMax={cfg.hpMax}
            energyMax={cfg.energyMax}
            specialThreshold={cfg.specialThreshold}
            locale={locale}
            size="xl"
          />
        </div>
        <div className="flex flex-1 flex-col items-center">
          <div className="text-[0.9em] font-bold tracking-widest text-off/80">
            {STATUS_LABELS[snap.status].ja} / {STATUS_LABELS[snap.status].en}
          </div>
          <div
            className="sw-display text-[4.2em] font-black leading-none tabular-nums"
            data-testid="arena-timer"
          >
            {lobby && snap.liveStartClock !== null
              ? formatClock(-gameMs)
              : live || snap.status === 'PAUSED'
                ? formatClock(timeLeft)
                : snap.status === 'FINALIZING'
                  ? 'FINAL'
                  : '--:--'}
          </div>
          {nextClashIn !== null && (
            <div
              className={`mt-1 rounded-full px-4 py-1 text-[1.4em] font-black ${nextClashIn < 10_000 ? 'bg-danger text-white sw-pulse' : 'bg-black/50'}`}
              data-testid="arena-next-clash"
            >
              {J(
                `あと${Math.ceil(nextClashIn / 1000)}秒で激突！`,
                `CLASH IN ${Math.ceil(nextClashIn / 1000)}s`,
              )}
            </div>
          )}
          <div className="mt-1 text-[0.8em] text-off/70">
            {snap.clashes.length}/{cfg.clashTimesMs.length} {locale === 'ja' ? '激突' : 'clashes'}
          </div>
        </div>
        <div className="w-[36%] rounded-2xl bg-black/45 p-[0.8vw] ring-1 ring-white/10 backdrop-blur-sm">
          <RobotGauge
            team={snap.teams.FUJIN}
            hp={displayHp.FUJIN}
            hpMax={cfg.hpMax}
            energyMax={cfg.energyMax}
            specialThreshold={cfg.specialThreshold}
            locale={locale}
            size="xl"
            align="right"
          />
        </div>
      </div>

      {/* Fairness strip: players and AP per team */}
      <div className="mt-[0.6vw] flex justify-between text-[1em] font-bold">
        {(['RAIJIN', 'FUJIN'] as const).map((t) => (
          <div
            key={t}
            className="rounded-full bg-black/45 px-4 py-1"
            style={{ color: TEAM_META[t].color }}
          >
            {TEAM_META[t].symbol} {snap.teams[t].participantCount}
            {locale === 'ja' ? '人' : ' players'} ・ AP {snap.teams[t].apRemaining}/
            {snap.teams[t].apTotal}
            {snap.leaders[t][0] && (
              <span className="ml-3 text-off/80">
                MVP: {snap.leaders[t][0].nickname}
                {snap.leaders[t][0].isBot ? ' (BOT)' : ''}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Centre banner */}
      <div className="flex flex-1 items-center justify-center">
        {banner && (
          <div
            key={banner.textJa + banner.until}
            className="sw-banner-in rounded-2xl bg-black/60 px-[3vw] py-[1vw] text-center ring-2"
            style={{
              ['--tw-ring-color' as string]: banner.teamId
                ? TEAM_META[banner.teamId].color
                : '#EFF5FF',
            }}
            data-testid="arena-banner"
          >
            <div
              className="sw-display text-[4.5em] font-black leading-tight"
              style={{ color: banner.teamId ? TEAM_META[banner.teamId].color : '#EFF5FF' }}
            >
              {banner.textJa}
            </div>
            <div className="text-[1.6em] font-bold text-off/80">{banner.textEn}</div>
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="flex items-end justify-between gap-[1.5vw]">
        <div className="w-[38%]">
          <EventFeed events={snap.recentEvents} limit={5} large />
        </div>
        <div className="flex flex-col items-center opacity-90">
          <Logo size="sm" />
        </div>
        {snap.joinOpen ? (
          <div
            className="pointer-events-auto flex items-center gap-[1vw] rounded-2xl bg-black/60 p-[0.8vw] ring-1 ring-white/15"
            data-testid="arena-qr"
          >
            <div className="text-right">
              <div className="text-[1.6em] font-black">
                {J('スマホで参加！', 'JOIN ON YOUR PHONE')}
              </div>
              <div className="text-[1.1em] font-bold text-amber">
                {cfg.entryFeeSats} sats → AP {cfg.apPerParticipant}
              </div>
              <div className="text-[0.9em] text-off/70">
                {locale === 'ja' ? '観戦は無料・ウォレット不要' : 'Watching is free'}
              </div>
              {snap.paymentMode === 'mock' && (
                <div className="mt-1 text-[0.9em] font-bold text-yellow-300">
                  DEMO MODE（実決済なし）
                </div>
              )}
            </div>
            <QrCode
              url={playUrl}
              size={Math.round(
                Math.max(
                  150,
                  Math.min(260, (typeof window !== 'undefined' ? window.innerWidth : 1920) * 0.12),
                ),
              )}
              label="参加用QRコード"
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-black/50 px-4 py-2 text-[1.1em] font-bold text-off/80">
            {snap.status === 'CREATED'
              ? locale === 'ja'
                ? 'まもなく参加受付開始'
                : 'Joining opens soon'
              : locale === 'ja'
                ? '参加受付は終了しました'
                : 'Joining closed'}
          </div>
        )}
      </div>

      {/* Status overlays */}
      {lobby && (
        <Overlay>
          <div className="text-[2.2em] font-black">{J('まもなく開戦', 'BATTLE STARTS SOON')}</div>
          <div className="sw-display text-[9em] font-black leading-none tabular-nums">
            {snap.liveStartClock !== null ? formatClock(-gameMs) : '--:--'}
          </div>
          <div className="mt-2 text-[1.6em] font-bold">
            {J('右下のQRからスマホで参加しよう', 'Scan the QR to join')}
          </div>
        </Overlay>
      )}
      {snap.status === 'CREATED' && (
        <Overlay>
          <Logo size="lg" />
          <div className="mt-6 text-[2em] font-bold">
            {J('次の試合を準備中', 'Next match is being prepared')}
          </div>
        </Overlay>
      )}
      {snap.status === 'PAUSED' && (
        <Overlay>
          <div className="text-[4em] font-black text-yellow-300">{J('一時停止中', 'PAUSED')}</div>
          <div className="mt-2 text-[1.5em]">
            {J(
              'しばらくお待ちください。APと参加権は失われません。',
              'Please wait. AP and entries are kept.',
            )}
          </div>
        </Overlay>
      )}
      {snap.status === 'CANCELLED' && (
        <Overlay>
          <div className="text-[4em] font-black">{J('試合中止', 'MATCH CANCELLED')}</div>
        </Overlay>
      )}
      {snap.status === 'FINISHED' && snap.result && (
        <div className="absolute inset-x-0 bottom-[22%] flex justify-center">
          <div
            className="rounded-2xl bg-black/70 px-[2vw] py-[1vw] text-center ring-1 ring-white/20"
            data-testid="arena-result"
          >
            <div className="text-[1.5em] font-bold">
              {RESULT_REASON_LABELS[snap.result.reason].ja} /{' '}
              {RESULT_REASON_LABELS[snap.result.reason].en}
            </div>
            <div className="mt-1 text-[1.4em]">
              HP {snap.result.finalHp.RAIJIN} - {snap.result.finalHp.FUJIN} ・{' '}
              {locale === 'ja' ? '地域' : 'Regions'} {snap.result.regionCounts.RAIJIN} -{' '}
              {snap.result.regionCounts.FUJIN}
            </div>
            <div className="mt-2 flex justify-center gap-8 text-[1.3em] font-bold">
              {(['RAIJIN', 'FUJIN'] as const).map((t) => (
                <span key={t} style={{ color: TEAM_META[t].color }}>
                  {TEAM_META[t].symbol} MVP: {snap.result!.mvp[t]?.nickname ?? '—'}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {(connState !== 'connected' || contextLost || stats) && (
        <div className="absolute right-2 top-[18%] rounded bg-black/60 px-2 py-1 text-[0.7em] font-mono">
          {connState !== 'connected' && <div className="text-yellow-300">{connState}</div>}
          {contextLost && <div className="text-yellow-300">WebGL lost → 2D</div>}
          {stats && (
            <div>
              {renderer} {stats.fps}fps {stats.frameMs}ms rtt {Math.round(conn.rttMs)}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy/55 text-center backdrop-blur-[2px]">
      {children}
    </div>
  );
}
