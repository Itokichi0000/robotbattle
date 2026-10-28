'use client';
import { useEffect, useState } from 'react';
import type { InvoiceResponse, PublicMatchSnapshot, RedeemPassResponse, TopupStatusResponse } from '@sats-wars/shared';
import { SATS_EXPLAINER, formatClock, zapsFor } from '@sats-wars/shared';
import { QrCode } from '@/components/QrCode';
import { ApiError, api } from '@/lib/api';
import type { MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { PlaySession } from './session';

/**
 * Top-up sheet: pick an amount once, pay one Lightning invoice, then just tap.
 * Credit is only added after the server re-verifies the payment.
 */
export function Topup({
  snap,
  conn,
  session,
  creditSats,
  onClose,
  onCredited,
}: {
  snap: PublicMatchSnapshot;
  conn: MatchConnection;
  session: PlaySession;
  creditSats: number;
  onClose: () => void;
  onCredited: (creditSats: number) => void;
}) {
  const { L, locale } = useI18n();
  useTicker(1000);
  const c = snap.config;
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const isMock = snap.paymentMode === 'mock';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = (added: number, balance: number) => {
    onCredited(balance);
    setDone(added);
    setTimeout(onClose, 1400);
  };

  // Socket push: credited the moment the server verified the payment.
  useEffect(
    () =>
      conn.onCredit((p) => {
        if (invoice && p.invoiceId === invoice.invoiceId && p.invoiceStatus === 'PAID') finish(p.addedSats, p.creditSats);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conn, invoice],
  );
  // Polling fallback (the server re-checks with the provider on each poll).
  useEffect(() => {
    if (!invoice || done !== null) return;
    const id = setInterval(async () => {
      try {
        const st = await api<TopupStatusResponse>(`/api/topups/${invoice.invoiceId}`, { token: session.token });
        if (st.status === 'PAID') finish(invoice.amountSats, st.creditSats);
        else if (st.status !== 'PENDING') setInvoice({ ...invoice, status: st.status });
      } catch {
        // transient; keep polling
      }
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, done, session.token]);

  const create = (amountSats: number) =>
    run(async () => {
      setInvoice(await api<InvoiceResponse>('/api/topups', { token: session.token, body: { amountSats } }));
    });

  const mockPay = () =>
    run(async () => {
      if (!invoice) return;
      const r = await api<{ status: string; creditSats: number }>('/api/dev/mock-pay', {
        token: session.token,
        body: { invoiceId: invoice.invoiceId },
      });
      if (r.status === 'PAID') finish(invoice.amountSats, r.creditSats);
    });

  const redeem = () =>
    run(async () => {
      const r = await api<RedeemPassResponse>('/api/codes/redeem', { token: session.token, body: { code } });
      finish(r.addedSats, r.creditSats);
    });

  const copy = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice.bolt11);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const expiresIn = invoice ? invoice.expiresAt - conn.serverNow() : null;
  const expired = !!invoice && (invoice.status === 'EXPIRED' || (expiresIn !== null && expiresIn <= 0));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center" role="dialog" aria-modal="true" aria-label={L('satsをチャージ', 'Top up sats')}>
      <div className="sw-panel max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-b-none p-4 sm:rounded-b-[14px]" data-testid="topup">
        <div className="flex items-center justify-between">
          <h2 className="sw-display text-2xl font-black">⚡ {L('satsをチャージ', 'Top up sats')}</h2>
          <button type="button" className="sw-focus rounded-full px-3 py-1 text-lg font-bold" onClick={onClose} aria-label={L('閉じる', 'Close')}>
            ✕
          </button>
        </div>

        {done !== null ? (
          <div className="py-10 text-center" data-testid="topup-done">
            <div className="text-6xl">🎉</div>
            <div className="sw-display mt-2 text-3xl font-black text-ok">+{done} sats</div>
            <div className="mt-1 font-bold">{L('チャージ完了！ さあパンチ！', 'Topped up! Go punch!')}</div>
          </div>
        ) : !invoice ? (
          <>
            <p className="mt-1 text-sm text-off/80">
              {L(
                `今の残高 ${creditSats} sats。チャージした分は今日ずっと使えます。`,
                `Balance ${creditSats} sats. Credit stays for the whole day.`,
              )}
            </p>
            {snap.paymentsEnabled ? (
              <div className="mt-3 grid gap-2">
                {c.topupOptionsSats.map((amt, i) => (
                  <button
                    key={amt}
                    type="button"
                    disabled={busy}
                    onClick={() => void create(amt)}
                    className={`sw-btn flex items-center justify-between px-4 py-3 text-left ${i === 1 ? 'bg-amber text-navy' : 'bg-white/12 text-off ring-1 ring-white/20'}`}
                    data-testid={`topup-${amt}`}
                  >
                    <span className="sw-display text-2xl">{amt} sats</span>
                    <span className="text-lg font-black">
                      → {L(`${zapsFor(amt, c)}発`, `${zapsFor(amt, c)} punches`)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded bg-yellow-300/15 p-3 text-sm font-bold text-yellow-200">
                {L(
                  '現在Lightningでのチャージは停止中です。スタッフ配布のコードは使えます。',
                  'Lightning top-ups are paused. Staff codes still work.',
                )}
              </p>
            )}
            {isMock && (
              <p className="mt-2 text-xs font-bold text-yellow-300">
                {L('デモモード：実際の支払いは発生しません', 'Demo mode: no real payment happens')}
              </p>
            )}

            <div className="mt-4 border-t border-line pt-3">
              <label className="text-sm font-bold" htmlFor="sw-code">
                🎟 {L('コードをお持ちの方（会場で配布）', 'Have a code from the venue?')}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="sw-code"
                  className="sw-focus min-w-0 flex-1 rounded-lg border border-line bg-black/40 px-3 py-2 font-mono uppercase"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  data-testid="code-input"
                />
                <button type="button" className="sw-btn bg-white/15 px-4" disabled={busy || code.trim().length < 4} onClick={() => void redeem()} data-testid="redeem">
                  {L('使う', 'Redeem')}
                </button>
              </div>
            </div>
            <p className="mt-4 text-xs text-off/60">
              💡 {SATS_EXPLAINER[locale]}
              {L(
                '。賞金・換金・払い戻しはありません。パンチに使ったsatsはイベント運営費になります。',
                '. No prizes or cash-out. Sats spent on punches support the event.',
              )}
            </p>
          </>
        ) : (
          <div className="mt-2 flex flex-col items-center gap-3" data-testid="invoice">
            <div className="text-center">
              <div className="sw-display text-3xl font-black">{invoice.amountSats} sats</div>
              <div className="font-bold text-off/85">= {L(`${invoice.zaps}発ぶん`, `${invoice.zaps} punches`)}</div>
            </div>
            {expired ? (
              <div className="w-full rounded bg-white/10 p-3 text-center">
                <p className="font-bold">{L('請求書の期限が切れました（支払いは発生していません）', 'Invoice expired (you were not charged)')}</p>
                <button type="button" className="sw-btn mt-2 w-full bg-amber text-navy" onClick={() => setInvoice(null)}>
                  {L('もう一度', 'Try again')}
                </button>
              </div>
            ) : (
              <>
                <QrCode url={`lightning:${invoice.bolt11}`} size={230} label={L('Lightning請求書', 'Lightning invoice')} caption={false} />
                <div className="grid w-full grid-cols-2 gap-2">
                  <a className="sw-btn flex items-center justify-center bg-amber text-navy" href={`lightning:${invoice.bolt11}`}>
                    {L('ウォレットで開く', 'Open wallet')}
                  </a>
                  <button type="button" className="sw-btn bg-white/15" onClick={() => void copy()}>
                    {copied ? L('コピーしました', 'Copied') : L('請求書をコピー', 'Copy invoice')}
                  </button>
                </div>
                <p className="text-sm text-off/75">
                  {L('支払い待ち… 自動で反映されます', 'Waiting for payment… updates automatically')}
                  {expiresIn !== null && ` ・ ${formatClock(expiresIn)}`}
                </p>
                {isMock && (
                  <button type="button" className="sw-btn w-full bg-yellow-300 text-navy" disabled={busy} onClick={() => void mockPay()} data-testid="mock-pay">
                    {L('テスト支払い（模擬・実際のお金は動きません）', 'Simulate payment (demo, no real money)')}
                  </button>
                )}
                <p className="text-center text-[11px] text-off/55">
                  {L('支払先', 'Payee')}: {invoice.payeeDescription}
                  <br />
                  {L(
                    '支払いが遅れて届いた場合も没収されず、残高に加算されます。',
                    'Late payments are never forfeited; they are added to your balance.',
                  )}
                </p>
                <button type="button" className="text-sm underline text-off/70" onClick={() => setInvoice(null)}>
                  {L('金額を選び直す', 'Choose another amount')}
                </button>
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 rounded bg-danger/20 p-2 text-center text-sm font-bold text-danger">{error}</p>}
      </div>
    </div>
  );
}
