import { formatClock } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { IconBolt, IconCrosshair, IconPilot, IconShield, IconWrench } from '@swed/ui-tokens';
import { useSyncExternalStore } from 'react';
import { joinInfo } from '../net';

/**
 * Waiting screen on the hangar (D-033). Readable in five seconds from across the hall: what
 * the game is, the three buttons, what 21 sats does, the QR, and when it starts. Anyone who
 * scans is in: no seats, no queue.
 */
export function Lobby({ s, mt }: { s: PublicMatchState | undefined; mt: number }) {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  const players = s?.players ?? 0;
  const startsIn = s?.phase === 'LOBBY' && s.autoStartAt !== null ? s.autoStartAt - mt : null;
  const sats = s?.hints.paidAmountSats ?? 21;
  return (
    <>
      <div className="lobby-title">
        <h1>
          SATS WARS<span>// EARTH DEFENSE</span>
        </h1>
        <div className="slogan">ONE MECH. EVERYONE PILOTS. DEFEND EARTH.</div>
        <div className="slogan-ja">エイリアンが地球に来る。みんなで雷神を動かして迎え撃て。</div>
      </div>
      <div className="mission how sw-frame">
        <div className="kick">HOW TO PLAY 遊び方 — 3つの班で雷神を動かす</div>
        <ol className="three">
          <li style={{ ['--acc' as string]: 'var(--sw-action)' }}>
            <IconCrosshair size={34} />
            <b>
              砲撃班<small className="sw-num"> {s?.teams.ATTACK ?? 0}人</small>
            </b>
            <span>スマホの敵機を撃ち落として母艦を削る</span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-ally)' }}>
            <IconShield size={34} />
            <b>
              防衛班<small className="sw-num"> {s?.teams.DEFEND ?? 0}人</small>
            </b>
            <span>ミサイルを弾いて仲間の部隊を守る</span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-repair)' }}>
            <IconWrench size={34} />
            <b>
              整備班<small className="sw-num"> {s?.teams.REPAIR ?? 0}人</small>
            </b>
            <span>火花をタップして雷神を直す</span>
          </li>
        </ol>
        <div className="sats">
          <IconBolt size={24} />
          <span>
            <b>遊ぶのは無料</b>。<b>{sats} sats</b> で「雷を呼ぶ」と、会場全員が
            <b>{s?.hints.feverMultiplier ?? 3}倍の雷モード</b>
            ＋送った人が母艦に雷を落とす（任意・1人1作戦 {s?.hints.paidPerPilot ?? 3}{' '}
            回まで）。出撃は全員でスマホを上にスワイプ！
          </span>
        </div>
      </div>
      <div className="pilots-count">
        <div className="n sw-num">
          {String(players).padStart(2, '0')} <small>PLAYERS 参加中</small>
        </div>
        <div className="pips">
          {Array.from({ length: Math.min(24, Math.max(8, players)) }, (_, i) => (
            <i key={i} className={i < players ? 'on' : ''}>
              {i < players ? <IconPilot size={16} /> : null}
            </i>
          ))}
        </div>
        <div className="tag">
          {startsIn !== null
            ? `まもなく出撃 ${formatClock(startsIn)} — 途中参加もOK`
            : players > 0
              ? '運営の出撃合図を待っています'
              : '最初の1人が参加すると出撃カウントが始まります'}
          {s && s.bots > 0 ? `（うち DEMO-BOT ${s.bots}）` : ''}
        </div>
      </div>
      <div className="qr sw-frame">
        {join ? (
          <img src="/api/public/join.svg" alt={`Join: ${join.joinUrl}`} />
        ) : (
          <div style={{ width: 200, height: 200 }} />
        )}
        <div>
          <div className="scan">SCAN TO JOIN</div>
          <div className="ja">スマホで読み取って参加（無料）</div>
          {/* Typed by hand when a camera will not read the QR: no scheme, one line. */}
          <div className="url">{join ? join.joinUrl.replace(/^https?:\/\//, '') : '...'}</div>
          <div className="note">
            {join?.mode === 'sandbox'
              ? 'SANDBOX: DEMO GUEST で参加（テスト用・お金は動きません）'
              : 'Lightningウォレットで本人確認（無料・支払いではありません）'}
          </div>
        </div>
      </div>
    </>
  );
}
