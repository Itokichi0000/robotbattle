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
          '応援するロボットを選んで、satsを送るとパンチ！ 会場の大画面で雷神と風神が殴り合い、先にHPを0にしたチームがその地方をゲット。ビットコインを知らなくても、タップするだけで遊べます。',
          'Pick a robot and send sats to punch! RAIJIN and FUJIN slug it out on the big screen; knock out the rival to win the region. No bitcoin knowledge needed — just tap.',
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
          L('ルールはひとつ', 'One rule'),
          L(
            '1タップ＝1パンチ（21 sats）。相手のHPを先に0にしたチームが、その地方をゲット。1ラウンド最長60秒。',
            'One tap = one punch (21 sats). Knock the rival to 0 HP first to win the region. Rounds last up to 60s.',
          ),
        ],
        [
          L('盛り上がる仕掛け', 'Built for hype'),
          L(
            'チーム10発ごとに必殺技。HPが減るとパンチ1.5倍で逆転のチャンス。パンチした人の名前が大画面に出ます。',
            'Every 10th team punch is a special. Low HP hits ×1.5 for comebacks. Your name pops up on the big screen.',
          ),
        ],
        [
          L('8地方で全国制覇', 'Conquer Japan'),
          L(
            '8ラウンドで多くの地方を取ったチームが全国制覇。シーズンは自動で繰り返し、残高はずっと使えます。',
            'Win the most of 8 regions to conquer Japan. Seasons loop automatically; your credit carries over.',
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
            'チャージしたsatsはゲーム内のパンチにだけ使えます。賞金・換金・払い戻し・抽選による景品はありません。',
            'Topped-up sats can only be used for in-game punches. No prizes, cash-out, refunds or lotteries.',
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
            '子どもの参加は保護者・運営の方針に従ってください。応援（📣）は無料、運営配布のコードでもパンチできます。',
            'Children should follow guardian/organiser guidance; cheering is free and staff codes also work.',
          )}
        </li>
      </ul>
      <p className="mt-3 text-xs text-off/60">{locale === 'ja' ? MAP_CREDIT_JA : MAP_CREDIT_EN}</p>
    </section>
  );
}
