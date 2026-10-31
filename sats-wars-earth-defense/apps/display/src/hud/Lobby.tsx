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
        <div className="slogan">ONE MECH. EVERYONE PILOTS. DEFEND JAPAN.</div>
        <div className="slogan-ja">みんなで雷神を動かして、日本を守れ。</div>
      </div>
      <div className="mission how sw-frame">
        <div className="kick">HOW TO PLAY 遊び方 — ボタンは3つだけ</div>
        <ol className="three">
          <li style={{ ['--acc' as string]: 'var(--sw-action)' }}>
            <IconCrosshair size={34} />
            <b>撃つ</b>
            <span>ボスの HP を削る</span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-ally)' }}>
            <IconShield size={34} />
            <b>守る</b>
            <span>攻撃予告の都市をシールドで守る</span>
          </li>
          <li style={{ ['--acc' as string]: 'var(--sw-repair)' }}>
            <IconWrench size={34} />
            <b>直す</b>
            <span>殴られた雷神を直す</span>
          </li>
        </ol>
        <div className="sats">
          <IconBolt size={24} />
          <span>
            <b>タップは無料（小）</b>。<b>{sats} sats</b>
            を送ると同じ行動の大きい版（任意・1人1作戦 {s?.hints.paidPerPilot ?? 3} 回まで）。
            払わなくても一緒に戦えます。
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
