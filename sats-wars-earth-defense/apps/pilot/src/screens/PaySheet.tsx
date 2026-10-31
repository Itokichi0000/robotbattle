import { useTicker } from '@swed/client';
import { PULSE_REFUSAL_TEXT } from '@swed/shared';
import type { PublicMatchState, PulseRefusal } from '@swed/shared';
import { IconBolt } from '@swed/ui-tokens';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { closePay, paymentsStore, refreshIntent, requestPaid } from '../net';
import { ACTION_VAR, actionName, effectText, useL } from '../ui';

/**
 * Lightning action (spec §8, §9.7, D-033): 21 sats makes the chosen action big. It is never
 * one tap: the sheet states the effect, the amount, the receiver, whether the money is real
 * or VIRTUAL, and that a payment may not be refundable — before any invoice exists. The
 * payment QR looks different from the sign-in QR on purpose.
 */
export function PaySheet({ s }: { s: PublicMatchState }) {
  const { L } = useL();
  const p = useSyncExternalStore(paymentsStore.subscribe, paymentsStore.get, paymentsStore.get);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  useTicker(1_000);

  useEffect(() => {
    if (p.intent?.status !== 'pending') return;
    const id = setInterval(() => void refreshIntent(), 3_000);
    return () => clearInterval(id);
  }, [p.intent?.status, p.intent?.intentId]);

  const kind = p.intent?.action ?? p.action;
  if (!kind) return null;
  const q = p.quote;
  const live = q?.mode === 'live';
  const big = q?.effect[kind] ?? s.hints.paid[kind];
  const free = s.hints.free[kind];
  const times = Math.max(1, Math.round(big / Math.max(1, free)));
  const err = p.error ? PULSE_REFUSAL_TEXT[p.error as PulseRefusal] : null;
  const name = actionName(kind, L);

  let body: React.ReactNode;
  if (p.intent) {
    const i = p.intent;
    const left = Math.max(0, Date.parse(i.expiresAt) - Date.now());
    if (i.status === 'pending') {
      body = (
        <>
          <p className="pay-amount sw-num">{i.amountSats} sats</p>
          <p className="note">{L(`受取先：${i.recipient}`, `To: ${i.recipient}`)}</p>
          {i.mode === 'live' && i.paymentRequest ? (
            <>
              <a className="btn primary" href={`lightning:${i.paymentRequest}`}>
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
                'テスト用の架空の請求書です（お金は動きません）。運営が確定すると大きな一撃が届きます。',
                'A test invoice, no real money. When staff confirm it, the big action lands.',
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
          <div className="pay-ok">
            <IconBolt size={36} />
            <b>{L(`着金！ 大きく${name}`, `Landed! Big ${name}`)}</b>
            <span>{effectText(kind, big, L)}</span>
            <small>{L('大画面を見て！', 'Look at the big screen!')}</small>
          </div>
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
        <p className="pay-what">
          <b>{effectText(kind, big, L)}</b>
          <span>
            {L(
              `無料タップの約 ${times} 回分を一撃で。全員同じ大きさで、多く払っても強くなりません。`,
              `About ${times} free taps in one go. Same size for everyone; paying more never makes it bigger.`,
            )}
          </span>
        </p>
        <dl className="pay-terms">
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
        <p className="note">
          {live
            ? L(
                '送金後の返金はできない場合があります。払わなくても無料タップで一緒に戦えます。',
                'Payments may not be refundable. You can keep playing free without paying.',
              )
            : L(
                '払わなくても無料タップで一緒に戦えます。',
                'You can keep playing free without paying.',
              )}
        </p>
        {err ? <p className="err">{L(err.ja, err.en)}</p> : null}
        <button
          className="btn primary"
          disabled={busy || !q?.enabled || !q.inCombat || q.remaining <= 0}
          onClick={async () => {
            setBusy(true);
            await requestPaid();
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
                  ? L('戦闘中だけ送れます', 'Only during the battle')
                  : L(`大きく${name}`, `Big ${name}`)}
            </small>
          </span>
        </button>
      </>
    );
  }

  return (
    <div className="sheet-back" onClick={closePay}>
      <div
        className={`sheet sw-frame${live ? ' live' : ''}`}
        role="dialog"
        aria-label={L(`21 sats で大きく${name}`, `Big ${name} for 21 sats`)}
        style={{ ['--acc' as string]: ACTION_VAR[kind] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <IconBolt size={18} />
          <b>{L(`Lightning で大きく${name}`, `Big ${name} with Lightning`)}</b>
          <button className="ph-lang" onClick={closePay} aria-label={L('閉じる', 'Close')}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
