import { useTicker } from '@swed/client';
import { PULSE_REFUSAL_TEXT } from '@swed/shared';
import type { PulseRefusal } from '@swed/shared';
import { IconBolt } from '@swed/ui-tokens';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { closePulse, loadQuote, paymentsStore, refreshIntent, requestPulse } from '../net';
import { useL } from '../ui';

/**
 * Shared energy pulse (spec §8, §9.7). Separate from the role controls: a pulse is never
 * required and never bought by tapping FIRE. The sheet states the amount, the receiver,
 * whether the money is real or VIRTUAL, and that a payment may not be refundable, before
 * any invoice exists. Pilot sign-in QR and payment QR look different on purpose.
 */
export function PulseSheet({ onClose }: { onClose: () => void }) {
  const { L } = useL();
  const p = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useTicker(1_000);
  void now;

  useEffect(() => {
    void loadQuote();
  }, []);
  useEffect(() => {
    if (p.intent?.status !== 'pending') return;
    const id = setInterval(() => void refreshIntent(), 3_000);
    return () => clearInterval(id);
  }, [p.intent?.status, p.intent?.intentId]);

  const q = p.quote;
  const live = q?.mode === 'live';
  const close = () => {
    closePulse();
    onClose();
  };
  const err = p.error ? PULSE_REFUSAL_TEXT[p.error as PulseRefusal] : null;

  let body: React.ReactNode;
  if (p.intent) {
    const i = p.intent;
    const left = Math.max(0, Date.parse(i.expiresAt) - Date.now());
    if (i.status === 'pending') {
      body = (
        <>
          <p className="pulse-amount sw-num">{i.amountSats} sats</p>
          <p className="note">{L(`受取先：${i.recipient}`, `To: ${i.recipient}`)}</p>
          {i.mode === 'live' && i.paymentRequest ? (
            <>
              <a className="btn primary action" href={`lightning:${i.paymentRequest}`}>
                <IconBolt size={20} />
                <span>{L('ウォレットで支払う', 'Pay in wallet')}</span>
              </a>
              <div className="lnurl-row">
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(i.paymentRequest!);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? L('コピーしました', 'Copied') : L('請求書をコピー', 'Copy invoice')}
                </button>
                <button className="btn" onClick={() => setShowQr((v) => !v)}>
                  {L('QRを表示', 'Show QR')}
                </button>
              </div>
              {showQr && i.qrSvg ? (
                <img
                  className="pay-qr"
                  alt={L('支払い用QR（実際の支払い）', 'Payment QR (real payment)')}
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(i.qrSvg)}`}
                />
              ) : null}
            </>
          ) : (
            <p className="virtual">
              VIRTUAL —{' '}
              {L(
                'テスト用の架空の請求書です。運営スタッフが確定するとパルスが届きます。',
                'A test invoice with no real money. Staff confirm it in the console.',
              )}
            </p>
          )}
          <p className="note" aria-live="polite">
            {L('支払い確認中…', 'Waiting for payment…')}{' '}
            <span className="sw-num">{Math.ceil(left / 1000)}s</span>
          </p>
        </>
      );
    } else if (i.status === 'settled') {
      body =
        i.applied === 'applied' ? (
          <p className="pulse-ok">
            {L(
              `着金しました。炉心復旧 ＋ 雷神ゲージ +${q?.capacitorGain ?? 20}%`,
              `Landed: reactor restored, RAIJIN gauge +${q?.capacitorGain ?? 20}%`,
            )}
          </p>
        ) : (
          <p className="err">
            {L(
              '作戦終了後に支払いが確認されたため、今回は反映されませんでした。運営が対応します。',
              'Paid after the round ended, so it was not applied. Staff will follow up.',
            )}
          </p>
        );
    } else {
      body = (
        <p className="err">
          {L(
            '請求書の期限が切れました（支払いは発生していません）',
            'The invoice expired (nothing was paid)',
          )}
        </p>
      );
    }
  } else {
    body = (
      <>
        <p className="pulse-what">
          {L(
            `送ると止まった炉心がすぐ復旧し、雷神ゲージ +${q?.capacitorGain ?? 20}%。電力B が回路をつないでも同じ効果なので、払わなくても勝てます。`,
            `Restores the stopped reactor at once and adds +${q?.capacitorGain ?? 20}% to the RAIJIN gauge. POWER B's repair does the same, so you can win without paying.`,
          )}
          {q && !q.crisis
            ? L(
                ' いまは炉心停止中ではないので送れません。',
                ' There is no blackout right now, so nothing to send.',
              )
            : null}
        </p>
        <dl className="pulse-terms">
          <div>
            <dt>{L('金額', 'Amount')}</dt>
            <dd className="sw-num">{q ? `${q.amountSats} sats` : '…'}</dd>
          </div>
          <div>
            <dt>{L('受取先', 'Receiver')}</dt>
            <dd>{q?.recipient ?? '…'}</dd>
          </div>
          <div>
            <dt>{L('種類', 'Type')}</dt>
            <dd className={live ? 'real' : 'virtual'}>
              {live
                ? L('実際の支払い（Lightning）', 'REAL payment (Lightning)')
                : L('VIRTUAL（架空・無料のテスト）', 'VIRTUAL (no real money)')}
            </dd>
          </div>
          <div>
            <dt>{L('この作戦の残り', 'Left this round')}</dt>
            <dd className="sw-num">{q ? q.remaining : '…'}</dd>
          </div>
        </dl>
        {live ? (
          <p className="note">
            {L(
              '送金後の返金はできない場合があります。金額は固定で、多く払っても強くなりません。',
              'Payments may not be refundable. The amount is fixed; paying more never makes you stronger.',
            )}
          </p>
        ) : null}
        {err ? <p className="err">{L(err.ja, err.en)}</p> : null}
        <button
          className={`btn primary ${live ? 'action' : 'ally'}`}
          disabled={busy || !q?.enabled || !q.inCombat || q.remaining <= 0 || !q.crisis}
          onClick={async () => {
            setBusy(true);
            await requestPulse();
            setBusy(false);
          }}
        >
          <IconBolt size={20} />
          <span>
            {busy
              ? L('請求書を作成中…', 'Creating invoice…')
              : live
                ? L(
                    `${q?.amountSats ?? 21} sats を支払う（実際の支払い）`,
                    `Pay ${q?.amountSats ?? 21} sats (real payment)`,
                  )
                : L(
                    `${q?.amountSats ?? 21} sats を送る（VIRTUAL・お金は動きません）`,
                    `Send ${q?.amountSats ?? 21} sats (VIRTUAL, no real money)`,
                  )}
            <small>
              {!q?.enabled
                ? L('現在停止中', 'Currently off')
                : !q.inCombat
                  ? L('搭乗中の戦闘中だけ', 'Only aboard, during combat')
                  : !q.crisis
                    ? L('炉心停止のときだけ送れます', 'Only during a blackout')
                    : L(
                        `炉心復旧 ＋ 雷神ゲージ +${q.capacitorGain}%`,
                        `Reactor back + gauge +${q.capacitorGain}%`,
                      )}
            </small>
          </span>
        </button>
      </>
    );
  }

  return (
    <div className="sheet-back" onClick={close}>
      <div
        className={`sheet sw-frame${live ? ' live' : ''}${p.quote?.crisis ? ' crisis' : ''}`}
        role="dialog"
        aria-label={L('共有エネルギー', 'Shared energy')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <IconBolt size={18} />
          <b>
            {p.quote?.crisis
              ? L('sats で炉心を即時復旧', 'Restore the reactor with sats')
              : L('sats（炉心停止のときだけ）', 'Sats (blackouts only)')}
          </b>
          <button className="ph-lang" onClick={close} aria-label={L('閉じる', 'Close')}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
