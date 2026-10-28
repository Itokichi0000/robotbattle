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
          'スマホで参加する日本列島の陣取り × 会場の大型スクリーンで激突する3Dロボットバトル。あなたの作戦が雷神と風神の戦況を動かす！',
          'Fight over Japan from your phone while giant robots clash on the venue screen. Your strategy moves the battle!',
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
        <a href="/play" className="sw-btn flex items-center border border-line px-6 text-lg">
          {L('観戦する（無料）', 'Watch (free)')}
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
          L('5分間の対戦', '5-minute matches'),
          L(
            '2チーム・日本の8地方で陣取り。45秒ごとにロボットが激突し、最後にHPが多いチームの勝ち。',
            'Two teams fight over 8 regions. Robots clash every 45s; most HP at the end wins.',
          ),
        ],
        [
          L('3つのアクション', '3 actions'),
          L(
            '⚔攻撃（占領・争奪）、🛡防御（シールド）、◆充電（必殺技エネルギー）。参加1回で3AP。',
            '⚔ Attack (capture/contest), 🛡 Defend (shield), ◆ Charge (special energy). 3 AP per entry.',
          ),
        ],
        [
          L('公平なルール', 'Fair by design'),
          L(
            '雷神と風神の性能は同じ。勝敗はサーバーが確定し、映像はその結果を演出します。金額で強くなることはありません。',
            'RAIJIN and FUJIN have identical stats. The server decides results; paying more never makes you stronger.',
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
            '参加費はイベント内のゲーム参加（行動権）の対価です。賞金・換金・抽選による金銭的景品はありません。',
            'The entry fee buys in-game actions only. No prizes, cash-out or lotteries.',
          )}
        </li>
        <li>
          {L(
            '支払先はイベント運営者です。支払い後に試合へ参加できなかった場合は、運営が繰越等で対応します。',
            'Payments go to the organisers. If you paid but could not play, staff will carry it over.',
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
            '子どもの参加は保護者・運営の方針に従ってください。無料のスポンサーパスで参加できます。',
            'Children should follow guardian/organiser guidance; free sponsored passes are available.',
          )}
        </li>
      </ul>
      <p className="mt-3 text-xs text-off/60">{locale === 'ja' ? MAP_CREDIT_JA : MAP_CREDIT_EN}</p>
    </section>
  );
}
