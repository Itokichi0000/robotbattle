'use client';
import type { PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import { REGION_INFO, SATS_EXPLAINER, TEAM_META } from '@sats-wars/shared';
import type { Banner, FrameStats } from '@sats-wars/three-game';
import { Logo } from '@/components/Logo';
import { QrCode } from '@/components/QrCode';
import { RobotGauge, teamColor } from '@/components/TeamBits';
import { battleView } from '@/lib/battle';
import type { ConnectionState, MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { CheerBubbles, ZapPopups } from './Popups';

/**
 * Venue HUD over the 3D (or 2D) scene. Designed for people walking past:
 * the how-to and the QR are ALWAYS on screen, and the only numbers that
 * matter (HP, "あと○発でKO", seconds) are huge.
 */
export function ArenaHud({
  snap,
  conn,
  connState,
  displayHp,
  banner,
  stats,
  renderer,
  contextLost,
  reducedMotion,
  preview = false,
}: {
  /** Rehearsal mode: hide status overlays so cinematics stay visible. */
  preview?: boolean;
  snap: PublicMatchSnapshot;
  conn: MatchConnection;
  connState: ConnectionState;
  displayHp: Record<TeamId, number>;
  banner: Banner | null;
  stats: FrameStats | null;
  renderer: 'webgl' | '2d';
  contextLost: boolean;
  reducedMotion: boolean;
}) {
  const { locale } = useI18n();
  useTicker(250);
  const v = battleView(snap, conn.now().clockMs);
  const c = snap.config;
  const fighting = snap.status === 'LIVE' && snap.phase === 'ROUND';
  const playUrl = snap.playUrl || (typeof window !== 'undefined' ? `${window.location.origin}/play` : '/play');
  const J = (ja: string, en: string) => (
    <>
      {ja}
      <span className="ml-2 text-[0.55em] font-bold opacity-70">{en}</span>
    </>
  );
  // HP numbers come from the director (server values, applied per punch);
  // before the first cue fall back to the snapshot.
  const hp = (t: TeamId) => (snap.round ? displayHp[t] : v.hp[t]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-[1.2vw] text-off" style={{ fontSize: 'clamp(12px, 1.05vw, 26px)' }}>
      {/* Top: team panels + round box */}
      <div className="flex items-start gap-[1.2vw]">
        {(['RAIJIN', 'FUJIN'] as const).map((t, i) => (
          <div key={t} className={`w-[36%] rounded-2xl bg-black/45 p-[0.8vw] ring-1 ring-white/10 backdrop-blur-sm ${i === 1 ? 'order-3' : ''}`}>
            <RobotGauge
              teamId={t}
              hp={hp(t)}
              hpMax={v.hpMax}
              toKo={v.toKo[t]}
              toSpecial={v.toSpecial[t]}
              pinch={v.pinch[t]}
              supporters={snap.supporters[t]}
              regionsWon={v.regionsWon[t]}
              fighting={fighting}
              locale={locale}
              size="xl"
              align={t === 'FUJIN' ? 'right' : 'left'}
            />
          </div>
        ))}
        <div className="order-2 flex flex-1 flex-col items-center">
          <div className="text-[1.1em] font-black tracking-wider text-off/85">
            {locale === 'ja' ? `第${v.roundNumber}戦` : `ROUND ${v.roundNumber}`}
            <span className="text-[0.8em] text-off/60"> / {v.roundsTotal}</span>
          </div>
          <div className="sw-display text-[2.3em] font-black leading-tight text-[#FFE27A]" data-testid="arena-region">
            ⚔ {locale === 'ja' ? v.regionJa : v.regionEn}
          </div>
          <div className="sw-display text-[4.2em] font-black leading-none tabular-nums" data-testid="arena-timer">
            {fighting && v.secondsLeft !== null ? v.secondsLeft : '—'}
          </div>
          <div className="text-[0.8em] text-off/70">{fighting ? (locale === 'ja' ? '秒' : 'sec') : ''}</div>
        </div>
      </div>

      {/* Region strip: the 8 fights of this season, in order */}
      <div className="mt-[0.6vw] flex justify-center gap-[0.4vw]" data-testid="region-strip">
        {snap.roundOrder.map((id, i) => {
          const paint = snap.regions.find((r) => r.regionId === id);
          const owner = paint?.ownerTeamId ?? null;
          const current = i === snap.roundIndex && (snap.phase === 'ROUND' || snap.phase === 'ROUND_END');
          const done = i < snap.roundIndex || (i === snap.roundIndex && snap.phase !== 'ROUND' && snap.phase !== 'OPENING');
          return (
            <div
              key={id}
              className={`rounded-lg px-[0.7vw] py-[0.2vw] text-[0.95em] font-black ${current ? 'ring-2 ring-[#FFE27A]' : ''}`}
              style={{ background: owner ? `${teamColor(owner)}cc` : done ? '#41506Ecc' : 'rgba(0,0,0,0.45)', color: owner ? '#070D1A' : '#EFF5FF' }}
            >
              {owner ? TEAM_META[owner].symbol : current ? '⚔' : `${i + 1}`} {locale === 'ja' ? REGION_INFO[id].shortJa : REGION_INFO[id].labelEn}
            </div>
          );
        })}
      </div>

      <ZapPopups conn={conn} />
      <CheerBubbles conn={conn} reducedMotion={reducedMotion} />

      {/* Banner in the lower third, so it never hides the robots */}
      <div className="flex flex-1 items-end justify-center pb-[2vh]">
        {banner ? (
          <div
            key={banner.textJa + banner.until}
            className="sw-banner-in rounded-2xl bg-black/65 px-[3vw] py-[1vw] text-center ring-2"
            style={{ ['--tw-ring-color' as string]: banner.teamId ? TEAM_META[banner.teamId].color : '#EFF5FF' }}
            data-testid="arena-banner"
          >
            <div className="sw-display text-[4.2em] font-black leading-tight" style={{ color: banner.teamId ? TEAM_META[banner.teamId].color : '#EFF5FF' }}>
              {banner.textJa}
            </div>
            {banner.subJa && <div className="text-[1.8em] font-black">{banner.subJa}</div>}
            <div className="text-[1.3em] font-bold text-off/75">
              {banner.textEn}
              {banner.subEn ? ` — ${banner.subEn}` : ''}
            </div>
          </div>
        ) : snap.status === 'LIVE' && (snap.phase === 'ROUND_END' || snap.phase === 'OPENING') && v.nextRegionId ? (
          <div className="rounded-2xl bg-black/60 px-[2vw] py-[0.6vw] text-center" data-testid="arena-next">
            <div className="text-[2em] font-black">
              {J(`次の戦い：${REGION_INFO[v.nextRegionId].labelJa}`, `Next: ${REGION_INFO[v.nextRegionId].labelEn}`)}
            </div>
            <div className="sw-display text-[3em] font-black tabular-nums">{v.secondsLeft ?? ''}</div>
            <div className="text-[1.2em] font-bold text-amber">{J('今のうちにQRからチームを選ぼう！', 'Scan the QR and pick a team now!')}</div>
          </div>
        ) : null}
      </div>

      {/* Bottom: feed | logo | how-to + QR (always visible) */}
      <div className="flex items-end justify-between gap-[1.5vw]">
        <div className="w-[30%]">
          {/* Round results only: every punch already pops up by name, specials get a banner. */}
          <ul className="flex flex-col gap-1" data-testid="round-results">
            {snap.rounds
              .slice(-3)
              .reverse()
              .map((r, i) => (
                <li
                  key={r.index}
                  className={`rounded-lg px-3 py-1 text-[1.15em] font-bold ${i === 0 ? 'bg-black/60' : 'bg-black/35 text-off/75'}`}
                  style={{ borderLeft: `4px solid ${teamColor(r.winnerTeamId)}` }}
                >
                  {locale === 'ja' ? `第${r.index + 1}戦 ${REGION_INFO[r.regionId].labelJa}` : `R${r.index + 1} ${REGION_INFO[r.regionId].labelEn}`}
                  {' → '}
                  {r.winnerTeamId
                    ? `${TEAM_META[r.winnerTeamId].symbol} ${locale === 'ja' ? TEAM_META[r.winnerTeamId].nameJa : TEAM_META[r.winnerTeamId].nameEn} ${r.endReason === 'KO' ? 'KO' : locale === 'ja' ? '判定' : 'on HP'}`
                    : locale === 'ja'
                      ? '引き分け'
                      : 'draw'}
                  {r.finisher && <span className="ml-2 text-[0.85em] text-off/70">{locale === 'ja' ? `とどめ：${r.finisher.nickname}` : `finisher: ${r.finisher.nickname}`}</span>}
                </li>
              ))}
          </ul>
        </div>
        <div className="flex flex-col items-center opacity-90">
          <Logo size="sm" />
        </div>
        <div className="pointer-events-auto flex items-center gap-[1vw] rounded-2xl bg-black/65 p-[0.8vw] ring-1 ring-white/15" data-testid="arena-qr">
          <ol className="text-right text-[1.25em] font-black leading-snug">
            <li>{J('① QRを読む', 'Scan')}</li>
            <li>{J('② 雷神か風神を選ぶ（無料）', 'Pick a robot (free)')}</li>
            <li>
              {J(`③ タップでパンチ！`, 'Tap to punch!')}
              <span className="ml-1 text-amber">{c.zapCostSats} sats</span>
            </li>
            <li className="text-[0.62em] font-bold text-off/70">{SATS_EXPLAINER[locale]}</li>
            <li className="text-[0.62em] font-bold text-off/70">
              {locale === 'ja' ? '会場で配られたsatsで遊べます・見るだけ＆応援は無料' : 'Use the sats handed out here · watching & cheering are free'}
            </li>
            {snap.paymentMode === 'mock' && <li className="text-[0.7em] text-yellow-300">DEMO MODE（実決済なし）</li>}
          </ol>
          <QrCode
            url={playUrl}
            size={Math.round(Math.max(150, Math.min(260, (typeof window !== 'undefined' ? window.innerWidth : 1920) * 0.12)))}
            label="参加用QRコード"
          />
        </div>
      </div>

      {/* Status overlays */}
      {!preview && snap.status === 'CREATED' && (
        <Overlay>
          <Logo size="lg" />
          <div className="mt-6 text-[2em] font-bold">{J('次のシーズンを準備中', 'Next season is being prepared')}</div>
        </Overlay>
      )}
      {!preview && snap.status === 'PAUSED' && (
        <Overlay>
          <div className="text-[4em] font-black text-yellow-300">{J('一時停止中', 'PAUSED')}</div>
          <div className="mt-2 text-[1.5em]">{J('しばらくお待ちください。残高は失われません。', 'Please wait. Your credit is safe.')}</div>
        </Overlay>
      )}
      {!preview && snap.status === 'CANCELLED' && (
        <Overlay>
          <div className="text-[4em] font-black">{J('シーズン中止', 'SEASON CANCELLED')}</div>
          <div className="mt-2 text-[1.5em]">{J('残高はそのまま次のシーズンで使えます。', 'Your credit carries over to the next season.')}</div>
        </Overlay>
      )}
      {(snap.phase === 'SEASON_END' || snap.status === 'FINISHED') && snap.result && (
        <div className="absolute inset-x-0 bottom-[30%] flex justify-center">
          <div className="rounded-2xl bg-black/70 px-[2vw] py-[0.8vw] text-center ring-1 ring-white/20" data-testid="arena-result">
            <div className="text-[1.6em] font-black">
              {J(`雷神 ${snap.result.regionCounts.RAIJIN} – ${snap.result.regionCounts.FUJIN} 風神`, `RAIJIN ${snap.result.regionCounts.RAIJIN} – ${snap.result.regionCounts.FUJIN} FUJIN`)}
            </div>
            <div className="mt-1 text-[1.2em] font-bold text-off/80">
              {J('まもなく次のシーズン！ 残高はそのまま使えます', 'Next season soon — your credit carries over')}
            </div>
          </div>
        </div>
      )}

      {(connState !== 'connected' || contextLost || stats) && (
        <div className="absolute right-2 top-[18%] rounded bg-black/60 px-2 py-1 font-mono text-[0.7em]">
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
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy/55 text-center backdrop-blur-[2px]">{children}</div>
  );
}
