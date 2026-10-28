'use client';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { REGION_INFO, SATS_EXPLAINER, TEAM_META } from '@sats-wars/shared';
import type { Banner, BannerTone, FrameStats } from '@sats-wars/three-game';
import { ComboGauge, FallMeter, TurnGauge } from '@/components/DefenceBits';
import { Logo } from '@/components/Logo';
import { QrCode } from '@/components/QrCode';
import type { BoardView } from '@/lib/battle';
import type { ConnectionState, MatchConnection } from '@/lib/connection';
import { useI18n } from '@/lib/i18n';
import { ActionPopups, CheerBubbles } from './Popups';

const TONE_COLOR: Record<BannerTone, string> = {
  ally: '#FFE27A',
  alien: '#C98BFF',
  neutral: '#EFF5FF',
  RAIJIN: TEAM_META.RAIJIN.color,
  FUJIN: TEAM_META.FUJIN.color,
};

/**
 * Venue HUD over the 3D (or 2D) scene. Designed for people walking past:
 * the how-to and the QR are ALWAYS on screen, and the only things that matter
 * (wave, moves until the alien turn, which region falls next) are huge.
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
  reducedMotion,
  preview = false,
}: {
  /** Rehearsal mode: hide status overlays so cinematics stay visible. */
  preview?: boolean;
  snap: PublicMatchSnapshot;
  view: BoardView;
  conn: MatchConnection;
  connState: ConnectionState;
  banner: Banner | null;
  stats: FrameStats | null;
  renderer: 'webgl' | '2d';
  contextLost: boolean;
  reducedMotion: boolean;
}) {
  const { locale } = useI18n();
  const c = snap.config;
  const live = snap.status === 'LIVE';
  const playUrl = snap.playUrl || (typeof window !== 'undefined' ? `${window.location.origin}/play` : '/play');
  const ja = locale === 'ja';
  const J = (jaText: string, en: string) => (
    <>
      {jaText}
      <span className="ml-2 text-[0.55em] font-bold opacity-70">{en}</span>
    </>
  );
  const boss = snap.enemies.some((e) => e.kind === 'MOTHERSHIP');
  const landing = [...new Set(snap.incoming.map((l) => l.regionId))];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col p-[1.2vw] text-off" style={{ fontSize: 'clamp(12px, 1.05vw, 26px)' }}>
      {/* Top: wave & turn | title | danger */}
      <div className="flex items-start gap-[1.2vw]">
        <div className="w-[34%] rounded-2xl bg-black/50 p-[0.8vw] ring-1 ring-white/10 backdrop-blur-sm" data-testid="arena-wave">
          <div className="sw-display text-[3.2em] font-black leading-none">
            {ja ? `ウェーブ ${snap.wave}` : `WAVE ${snap.wave}`}
            {boss && <span className="ml-3 text-[0.55em] text-fuchsia-300">🪐 {ja ? '母艦' : 'MOTHERSHIP'}</span>}
          </div>
          {live && (
            <div className="mt-[0.4vw] grid gap-[0.2vw] text-[1.35em]">
              <TurnGauge left={view.turnLeft} total={c.actionsPerTurn} locale={locale} />
              <ComboGauge combo={snap.combo} max={c.comboGaugeMax} locale={locale} />
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col items-center text-center">
          <div className="sw-display text-[2.4em] font-black leading-tight text-[#FFE27A]">{J('地球防衛軍', 'EARTH DEFENSE')}</div>
          <div className="text-[1.2em] font-bold text-off/85">
            {ja ? `隊員 ${snap.playersOnline}人 参戦中` : `${snap.playersOnline} defenders online`}
            {snap.bestWave > 0 && <span className="ml-3 text-off/65">{ja ? `最高記録 ウェーブ${snap.bestWave}` : `Best: wave ${snap.bestWave}`}</span>}
          </div>
        </div>
        <div className="w-[34%] rounded-2xl bg-black/50 p-[0.8vw] text-right ring-1 ring-white/10 backdrop-blur-sm" data-testid="arena-danger">
          <div className="text-[1.5em]">
            <FallMeter fallen={view.fallenCount} limit={c.fallLimit} locale={locale} />
          </div>
          {live && view.doomed.length > 0 ? (
            <div className="mt-[0.3vw] rounded-lg bg-danger/35 px-2 py-1 text-[1.45em] font-black" data-testid="arena-doomed">
              ⚠ {ja ? `${view.doomed.map((id) => REGION_INFO[id].shortJa).join('・')} が次の敵ターンでとられる！` : `${view.doomed.map((id) => REGION_INFO[id].labelEn).join(', ')} falls next turn!`}
            </div>
          ) : live ? (
            <div className="mt-[0.3vw] text-[1.2em] font-bold text-off/75">{ja ? '今のところ安全。敵を減らそう！' : 'Safe for now. Thin them out!'}</div>
          ) : null}
          {live && landing.length > 0 && (
            <div className="mt-[0.2vw] text-[1.1em] font-bold text-fuchsia-200">
              🛸 {ja ? `次の着陸予告：${landing.map((id) => REGION_INFO[id].shortJa).join('・')}` : `Landing next: ${landing.map((id) => REGION_INFO[id].labelEn).join(', ')}`}
            </div>
          )}
        </div>
      </div>

      <ActionPopups conn={conn} locale={locale} />
      <CheerBubbles conn={conn} reducedMotion={reducedMotion} />

      {/* Banner in the lower third, so it never hides the map */}
      <div className="flex flex-1 items-end justify-center pb-[2vh]">
        {banner && (
          <div
            key={banner.textJa + banner.until}
            className="sw-banner-in rounded-2xl bg-black/65 px-[3vw] py-[1vw] text-center ring-2"
            style={{ ['--tw-ring-color' as string]: TONE_COLOR[banner.tone] }}
            data-testid="arena-banner"
          >
            <div className="sw-display text-[4.2em] font-black leading-tight" style={{ color: TONE_COLOR[banner.tone] }}>
              {banner.textJa}
            </div>
            {banner.subJa && <div className="text-[1.8em] font-black">{banner.subJa}</div>}
            <div className="text-[1.3em] font-bold text-off/75">
              {banner.textEn}
              {banner.subEn ? ` — ${banner.subEn}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: campaign stats | logo | how-to + QR (always visible) */}
      <div className="flex items-end justify-between gap-[1.5vw]">
        <div className="w-[30%] rounded-xl bg-black/45 px-3 py-2 text-[1.15em] font-bold" data-testid="arena-stats">
          <div>
            {ja
              ? `撃破 ${snap.stats.kills}体 ・ 奪還 ${snap.stats.regionsLiberated} ・ 合体技 ${snap.stats.combos}`
              : `${snap.stats.kills} kills ・ ${snap.stats.regionsLiberated} liberated ・ ${snap.stats.combos} combos`}
          </div>
          <div className="text-[0.85em] text-off/70">
            {ja ? `みんなで ${snap.stats.actions}回 出撃 ・ 敵ターン ${snap.stats.alienTurns}回` : `${snap.stats.actions} moves together ・ ${snap.stats.alienTurns} alien turns`}
          </div>
        </div>
        <div className="flex flex-col items-center opacity-90">
          <Logo size="sm" />
        </div>
        <div className="pointer-events-auto flex items-center gap-[1vw] rounded-2xl bg-black/65 p-[0.8vw] ring-1 ring-white/15" data-testid="arena-qr">
          <ol className="text-right text-[1.25em] font-black leading-snug">
            <li>{J('① QRを読む', 'Scan')}</li>
            <li>
              {J('② 「おすすめで出撃」をタップ', 'Tap "Auto defend"')}
              <span className="ml-1 text-amber">{c.actionCostSats} sats</span>
            </li>
            <li>{J('③ 名前が画面に出る！ みんなで日本を守ろう', 'Your name appears! Defend Japan together')}</li>
            <li className="text-[0.62em] font-bold text-off/70">{SATS_EXPLAINER[locale]}</li>
            <li className="text-[0.62em] font-bold text-off/70">
              {ja ? '会場で配られたsatsで遊べます・時間制限なし・見るだけ＆応援は無料' : 'Use the sats handed out here · no time limit · watching & cheering are free'}
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
          <div className="mt-6 text-[2em] font-bold">{J('次の防衛戦を準備中', 'Next defence is being prepared')}</div>
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
          <div className="text-[4em] font-black">{J('防衛戦 中止', 'DEFENCE CANCELLED')}</div>
          <div className="mt-2 text-[1.5em]">{J('残高はそのまま次の防衛戦で使えます。', 'Your credit carries over to the next defence.')}</div>
        </Overlay>
      )}
      {snap.status === 'FINISHED' && snap.result && (
        <div className="absolute inset-x-0 top-[22%] flex justify-center">
          <div className="rounded-2xl bg-black/75 px-[2vw] py-[0.8vw] text-center ring-1 ring-fuchsia-400/50" data-testid="arena-result">
            <div className="sw-display text-[2.4em] font-black text-fuchsia-200">
              {J(`ウェーブ${snap.result.reachedWave}まで守りぬいた！`, `Held out until wave ${snap.result.reachedWave}!`)}
            </div>
            <div className="mt-1 text-[1.3em] font-bold">
              {ja
                ? `撃破 ${snap.result.stats.kills}体 ・ 奪還 ${snap.result.stats.regionsLiberated}回 ・ みんなで ${snap.result.stats.actions}回 出撃`
                : `${snap.result.stats.kills} kills ・ ${snap.result.stats.regionsLiberated} liberations ・ ${snap.result.stats.actions} moves`}
            </div>
            <div className="mt-1 text-[1.2em] font-bold text-off/80">
              {J('まもなく次の防衛戦！ 残高はそのまま使えます', 'Next defence soon — your credit carries over')}
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
