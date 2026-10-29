'use client';
import { MAP_CREDIT_EN, MAP_CREDIT_JA } from '@sats-wars/shared';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useI18n } from '@/lib/i18n';

export function LandingHeader() {
  const { L } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg text-off/90">
        {L(
          '謎の侵蝕体 NULL CORE が日本の8都市を狙っている！ 会場のみんなで雷神と風神のコックピットに乗り込み、砲撃・防衛・電力・整備の4つの席で協力して8分間守りぬこう。ボタンを押すだけで遊べます。',
          'NULL CORE is coming for Japan’s 8 cities! Everyone at the venue boards RAIJIN and FUJIN — gunner, guardian, router or engineer — and defends together for 8 minutes. Just tap to play.',
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href="/play"
          className="sw-btn flex items-center bg-amber px-6 text-lg text-navy"
          data-testid="cta-play"
        >
          {L('スマホで参加する', 'Join from your phone')}
        </a>
        <a href="/arena" className="sw-btn flex items-center border border-line px-6 text-lg">
          {L('会場スクリーン', 'Arena screen')}
        </a>
        <a href="/passport" className="sw-btn flex items-center border border-line px-6 text-lg">
          🪪 {L('パイロット手帳', 'Passport')}
        </a>
        <a
          href="/pilot/create"
          className="sw-btn flex items-center border border-line px-6 text-lg"
        >
          {L('ライセンス発行', 'Get a license')}
        </a>
        <a href="/demo" className="sw-btn flex items-center border border-line px-6 text-lg">
          {L('デモで遊ぶ', 'Try the demo')}
        </a>
        <a href="/leaderboard" className="sw-btn flex items-center border border-line px-6 text-lg">
          🏆 {L('記録', 'Records')}
        </a>
        <LanguageToggle />
      </div>
    </div>
  );
}

export function LandingRules() {
  const { L } = useI18n();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        [
          L('4つの席で協力', 'Four seats, one crew'),
          L(
            '🎯砲撃（雷神で弱点を撃つ）🛡防衛（風神で街を守る）🔌電力（エネルギーをつなぐ）🔧整備（修理）。どの席もミニゲーム1回が数秒。いま必要な席は画面が教えてくれます。',
            '🎯 Gunner (Raijin hits weak points), 🛡 Guardian (Fujin shields cities), 🔌 Router (energy), 🔧 Engineer (repairs). Each mission is a few-second minigame; the screen shows which seat is needed.',
          ),
        ],
        [
          L('攻撃は予告つき', 'Attacks are announced'),
          L(
            '敵は攻撃の前に⚠でねらう都市と残り秒数を見せます。間に合えば守れる！ 4都市を下回ると日本陥落。',
            'Enemies show ⚠ target and countdown before they strike. Make it in time and the city is safe. Below 4 cities, Japan falls.',
          ),
        ],
        [
          L('最終技 神雷風陣', 'Final special: SHINRAI FUJIN'),
          L(
            '最終決戦で砲撃・防衛・電力の3人がそろってSYNCが高いと、雷神と風神の合体技が発動。人数ではなく連携で勝つゲームです。',
            'In the final wave, three different pilots (gunner, guardian, router) plus high SYNC fire the combined special. Teamwork wins, not head count.',
          ),
        ],
      ].map(([title, body]) => (
        <div key={title} className="sw-panel p-4">
          <h3 className="text-lg font-black">{title}</h3>
          <p className="mt-1 text-sm text-off/80">{body}</p>
        </div>
      ))}
    </div>
  );
}

export function LandingTerms() {
  const { L, locale } = useI18n();
  return (
    <section id="terms" className="sw-panel p-4 text-sm text-off/80">
      <h2 className="text-lg font-black text-off">
        {L('利用条件・個人情報の扱い（雛形）', 'Terms & privacy (template)')}
      </h2>
      <p className="mt-1 text-xs text-yellow-200">
        {L(
          '※ これは雛形です。運営者が関係法令・会場規約を確認のうえ確定してください。',
          '* Template only. Organisers must review applicable law and venue rules before use.',
        )}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          {L(
            '出撃パス（1作戦 21 sats）は、その作戦に参加する権利です。払った額で強くはならず、賞金・換金・払い戻し・抽選による景品はありません。',
            'A raid pass (21 sats per raid) is the right to fly that raid. Paying never makes you stronger. No prizes, cash-out, refunds or lotteries.',
          )}
        </li>
        <li>
          {L(
            '支払先はイベント運営者です。作戦の締切後に届いた支払いは没収せず、次の作戦で使える出撃パスとして残します。',
            'Payments go to the organisers. A payment that arrives after boarding closes is never forfeited; it becomes a pass for a later raid.',
          )}
        </li>
        <li>
          {L(
            'コールサインは任意で、本名は不要です。大画面には本人が許可したときだけ表示し、それ以外は PILOT-番号 で表示します。不適切な表示は運営が非表示にできます。',
            'Callsigns are optional. They appear on the big screen only if you allow it (PILOT-number otherwise); staff can hide inappropriate names.',
          )}
        </li>
        <li>
          {L(
            'Lightningログイン（LNURL-auth）は鍵を持っていることの確認で、本人確認ではありません。秘密鍵やシードを入力させることは絶対にありません。支払い情報・IP・ウォレット識別子は会場画面に表示しません。',
            'Lightning login (LNURL-auth) proves key possession, not identity. We never ask for seeds or private keys. Payment data, IPs and wallet identifiers are never shown publicly.',
          )}
        </li>
        <li>
          {L(
            '子どもの参加は保護者・運営の方針に従ってください。応援（📣）は無料、運営配布のコードでも遊べます。',
            'Children should follow guardian/organiser guidance; cheering is free and staff codes also work.',
          )}
        </li>
      </ul>
      <p className="mt-3 text-xs text-off/60">{locale === 'ja' ? MAP_CREDIT_JA : MAP_CREDIT_EN}</p>
    </section>
  );
}
