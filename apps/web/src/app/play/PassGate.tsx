'use client';
import { useEffect, useState } from 'react';
import type { InvoiceResponse, InvoiceStatusResponse, PublicRaidSnapshot } from '@sats-wars/shared';
import { SATS_EXPLAINER } from '@sats-wars/shared';
import { Term } from '@/components/Term';
import { QrCode } from '@/components/QrCode';
import { ApiError, api } from '@/lib/api';
import type { RaidConnection } from '@/lib/connection';
import { useI18n } from '@/lib/i18n';

/**
 * Raid pass: one 21-sat payment (or a sponsored code) lets this pilot fly the
 * whole raid. Paying more never makes anyone stronger. The pass is granted
 * only after the server re-verifies the payment with the provider.
 */
export function PassGate({
  snap,
  conn,
  pending,
  onGranted,
}: {
  snap: PublicRaidSnapshot;
  conn: RaidConnection;
  pending: InvoiceResponse | null;
  onGranted: () => void;
}) {
  const { L, locale } = useI18n();
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(pending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Socket push: granted the moment the server verified the payment.
  useEffect(() => conn.onEntitlement(() => onGranted()), [conn, onGranted]);
  // Polling fallback (each poll makes the server re-check with the provider).
  useEffect(() => {
    if (!invoice || invoice.status !== 'PENDING') return;
    const id = setInterval(async () => {
      try {
        const st = await api<InvoiceStatusResponse>(`/api/invoices/${invoice.invoiceId}/status`);
        if (st.entitled) onGranted();
        else if (st.status !== 'PENDING') setInvoice({ ...invoice, status: st.status });
      } catch {
        // transient; keep polling
      }
    }, 2500);
    return () => clearInterval(id);
  }, [invoice, onGranted]);

  if (!snap.paymentsEnabled) {
    return (
      <div className="sw-panel p-4 text-center" data-testid="payments-paused">
        <p className="font-bold">
          {L('ただいま出撃パスの受付を一時停止しています', 'Raid passes are paused right now')}
        </p>
        <p className="text-sm text-muted">
          {L(
            'スタッフにスポンサーパスのコードをもらってください',
            'Ask the staff for a sponsored pass code',
          )}
        </p>
        <SponsoredForm
          code={code}
          setCode={setCode}
          busy={busy}
          onSubmit={() => run(async () => redeem(code, onGranted))}
          L={L}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="sw-panel flex flex-col gap-3 p-4" data-testid="pass-gate">
      <h3 className="sw-display text-lg">
        {L('出撃パス', 'Raid pass')} {snap.ticketPriceSats} <Term k="sats">sats</Term>
      </h3>
      <p className="text-xs">
        <Term k="lightning">{L('Lightningとは？', 'What is Lightning?')}</Term>
      </p>
      <p className="text-sm text-muted">
        {L(
          '1回払うとこの作戦の間ずっと全部の席で遊べます。払った額で強くはなりません。',
          'One payment covers this whole raid, any seat. Paying more never makes you stronger.',
        )}
      </p>
      <p className="text-xs text-muted">
        {locale === 'ja' ? SATS_EXPLAINER.ja : SATS_EXPLAINER.en}
      </p>
      {!invoice ||
      invoice.status === 'EXPIRED' ||
      invoice.status === 'FAILED' ||
      invoice.status === 'CANCELLED' ? (
        <button
          type="button"
          className="sw-btn bg-amber px-4 text-lg text-navy"
          disabled={busy}
          onClick={() =>
            run(async () =>
              setInvoice(
                await api<InvoiceResponse>('/api/raids/current/pass/invoice', { body: {} }),
              ),
            )
          }
          data-testid="buy-pass"
        >
          ⚡{' '}
          {L(
            `${snap.ticketPriceSats} sats で出撃パス`,
            `Get a pass for ${snap.ticketPriceSats} sats`,
          )}
        </button>
      ) : (
        <div className="flex flex-col items-center gap-2" data-testid="invoice">
          {isMock ? (
            <p className="rounded bg-amber/20 px-2 py-1 text-sm font-bold text-amber-light">
              {L('テストモード：本物の支払いではありません', 'TEST MODE: not a real payment')}
            </p>
          ) : (
            <QrCode
              url={`lightning:${invoice.bolt11}`}
              size={240}
              caption={false}
              label={L('Lightning請求書', 'Lightning invoice')}
            />
          )}
          <p className="text-sm">
            {L(
              'ウォレットで支払うと自動で出撃できます',
              'Pay with your wallet; boarding opens automatically',
            )}
          </p>
          {!isMock && (
            <div className="flex gap-2">
              <a
                className="sw-btn sw-focus bg-teal px-4 py-3 text-navy"
                href={`lightning:${invoice.bolt11}`}
              >
                {L('ウォレットを開く', 'Open wallet')}
              </a>
              <button
                type="button"
                className="sw-btn bg-navy-3 px-4"
                onClick={() => {
                  void navigator.clipboard?.writeText(invoice.bolt11).then(() => setCopied(true));
                }}
              >
                {copied ? L('コピーしました', 'Copied') : L('請求書をコピー', 'Copy invoice')}
              </button>
            </div>
          )}
          {isMock && (
            <button
              type="button"
              className="sw-btn bg-amber px-4 text-navy"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const st = await api<InvoiceStatusResponse>('/api/dev/mock-pay', {
                    body: { invoiceId: invoice.invoiceId },
                  });
                  if (st.entitled) onGranted();
                })
              }
              data-testid="mock-pay"
            >
              {L('テスト支払い（無料）', 'Test payment (free)')}
            </button>
          )}
          <p className="text-xs text-muted">
            {L('支払いの確認には数秒かかることがあります', 'Confirmation can take a few seconds')}
          </p>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-muted">
          {L('スポンサーパスのコードを持っている', 'I have a sponsored pass code')}
        </summary>
        <SponsoredForm
          code={code}
          setCode={setCode}
          busy={busy}
          onSubmit={() => run(async () => redeem(code, onGranted))}
          L={L}
        />
      </details>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

async function redeem(code: string, onGranted: () => void) {
  await api('/api/raids/current/pass/sponsored', { body: { code: code.trim() } });
  onGranted();
}

function SponsoredForm({
  code,
  setCode,
  busy,
  onSubmit,
  L,
}: {
  code: string;
  setCode: (s: string) => void;
  busy: boolean;
  onSubmit: () => void;
  L: (ja: string, en: string) => string;
}) {
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        className="sw-focus min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-navy px-3 uppercase"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="SW-XXXX-XXXX"
        aria-label={L('スポンサーパスのコード', 'Sponsored pass code')}
        maxLength={32}
        autoComplete="off"
        data-testid="sponsored-code"
      />
      <button
        type="submit"
        className="sw-btn bg-teal px-4 text-navy"
        disabled={busy || code.trim().length < 4}
      >
        {L('使う', 'Use')}
      </button>
    </form>
  );
}
