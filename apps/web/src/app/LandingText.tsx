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
          'エイリアンが日本に攻めてきた！ satsを送ると雷神と風神が出撃。会場のみんなで協力して、8つの地方を守りぬこう。ビットコインを知らなくても、ボタンを押すだけで遊べます。',
          'Aliens are invading Japan! Send sats and RAIJIN & FUJIN strike back. Everyone at the venue is on the same team — defend all 8 regions. No bitcoin knowledge needed — just tap.',
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
          L('みんなで協力', 'All on one team'),
          L(
            '1回 21 sats で雷神か風神が1回うごく。迷ったら「おすすめ」ボタンでOK。時間制限はなく、みんなの一手でゲームが進みます。',
            'Each move costs 21 sats. Not sure what to do? Press Auto. There is no timer: the game advances with every paid move.',
          ),
        ],
        [
          L('敵ターンは予告つき', 'Alien turns are announced'),
          L(
            'みんなで8回うごくとエイリアンのターン。次にとられる地方には⚠が出るので、倒すか🛡結界で守ろう。⚡は1体に大ダメージ、🌀は全体攻撃、💥は合体技。',
            'Every 8 moves the aliens strike. Regions about to fall show ⚠: defeat the aliens or raise a 🛡 barrier. ⚡ hits one, 🌀 hits all, 💥 is the combo.',
          ),
        ],
        [
          L('日本陥落まで', 'Until Japan falls'),
          L(
            'ウェーブごとに敵は強くなり、5地方とられたら日本陥落。何ウェーブ守れるかに挑戦！ 防衛戦は自動でくり返し、残高はずっと使えます。',
            'Waves get tougher; 5 captured regions and Japan falls. How long can the venue hold? Campaigns loop automatically and your credit carries over.',
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
            'チャージしたsatsはゲーム内の出撃にだけ使えます。賞金・換金・払い戻し・抽選による景品はありません。',
            'Topped-up sats can only be used for in-game moves. No prizes, cash-out, refunds or lotteries.',
          )}
        </li>
        <li>
          {L(
            '支払先はイベント運営者です。支払いが遅れて届いた場合も没収せず残高に加算します。残高は当日中ずっと使えます。',
            'Payments go to the organisers. Late payments are never forfeited; they are added to your balance for the day.',
          )}
        </li>
        <li>
          {L(
            'ニックネームは任意で、本名は不要です。不適切な表示は運営が非表示にできます。',
            'Nicknames are optional; staff can hide inappropriate names.',
          )}
        </li>
        <li>
          {L(
            '支払い情報・IPアドレス・ウォレット識別子は会場画面に表示しません。請求書データは一定期間後に削除します。',
            'Payment data, IP addresses and wallet identifiers are never shown publicly; invoice data is deleted after a retention period.',
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
