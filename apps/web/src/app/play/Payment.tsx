'use client';
import { useEffect, useState } from 'react';
import type {
  InvoiceResponse,
  PaymentStatusResponse,
  PublicMatchSnapshot,
} from '@sats-wars/shared';
import { TEAM_META, formatClock } from '@sats-wars/shared';
import { QrCode } from '@/components/QrCode';
import { ApiError, api } from '@/lib/api';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { Me } from './PlayApp';
import type { PlaySession } from './session';

type View = 'choose' | 'invoice' | 'pass';

export function Payment({
  snap,
  session,
  me,
  onChanged,
  onCancel,
  serverNow,
}: {
  serverNow: () => number;
  snap: PublicMatchSnapshot;
  session: PlaySession;
  me: Me;
  onChanged: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { L } = useI18n();
  const [view, setView] = useState<View>(me.invoiceStatus === 'PENDING' ? 'invoice' : 'choose');
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  useTicker(1000);
  const team = TEAM_META[session.teamId];

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

  const issueInvoice = () =>
    run(async () => {
      const inv = await api<InvoiceResponse>('/api/join/invoice', {
        token: session.token,
        body: { reservationId: session.reservationId },
      });
      setInvoice(inv);
      setView('invoice');
    });

  // Resume an existing pending invoice after reload.
  useEffect(() => {
    if (view === 'invoice' && !invoice && me.invoiceStatus === 'PENDING') void issueInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll as a fallback to socket pushes (server re-verifies with the provider).
  useEffect(() => {
    if (view !== 'invoice') return;
    const id = setInterval(async () => {
      try {
        const st = await api<PaymentStatusResponse>(
          `/api/join/payment-status/${session.reservationId}`,
          { token: session.token },
        );
        if (st.participantStatus === 'ACTIVE' || st.invoiceStatus !== 'PENDING') await onChanged();
      } catch {
        // transient; keep polling
      }
    }, 4000);
    return () => clearInterval(id);
  }, [view, session, onChanged]);

  const redeem = () =>
    run(async () => {
      await api('/api/join/redeem-pass', {
        token: session.token,
        body: { reservationId: session.reservationId, code },
      });
      await onChanged();
    });

  const mockPay = () =>
    run(async () => {
      if (!invoice) return;
      await api('/api/dev/mock-pay', {
        token: session.token,
        body: { invoiceId: invoice.invoiceId },
      });
      await onChanged();
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

  const expiresIn = invoice ? invoice.expiresAt - serverNow() : null;
  const expired = me.invoiceStatus === 'EXPIRED' || (expiresIn !== null && expiresIn <= 0);
  const isMock = snap.paymentMode === 'mock';

  return (
    <div className="flex flex-col gap-4">
      <section className="sw-panel p-4">
        <p className="text-sm text-off/80">
          {L('あなたのチーム（仮）', 'Your team (provisional)')}
        </p>
        <p
          className="sw-display text-3xl font-black"
          style={{ color: team.color }}
          data-testid="team"
        >
          {team.symbol} {L(team.nameJa, team.nameEn)}
        </p>
        <p className="mt-1 text-xs text-off/70">
          {L(
            '支払い（またはパス）が確認されると確定し、APが付与されます。',
            'Confirmed once payment (or a pass) is verified; then you receive AP.',
          )}
        </p>
      </section>

      {view === 'choose' && (
        <section className="sw-panel flex flex-col gap-3 p-4">
          <h2 className="text-lg font-black">
            {L('参加方法を選んでください', 'Choose how to join')}
          </h2>
          <div className="rounded-lg bg-black/30 p-3 text-sm leading-relaxed">
            <p>
              <b>{L('参加費', 'Entry fee')}</b>: {snap.config.entryFeeSats} sats（Lightning）→ AP{' '}
              {snap.config.apPerParticipant}
            </p>
            <p>
              <b>{L('支払先', 'Paid to')}</b>:{' '}
              {L('SATS WARS 運営（イベント主催者）', 'SATS WARS organisers (event host)')}
            </p>
            <p>
              <b>{L('使途', 'Purpose')}</b>:{' '}
              {L(
                'この試合への参加（ゲーム内の行動権）。賞金・換金はありません。',
                'Entry to this match (in-game actions only). No prizes or cash-out.',
              )}
            </p>
            <p>
              <b>{L('うまくいかない時', 'If something fails')}</b>:{' '}
              {L(
                '期限切れの請求書には支払えません。試合終了後に入金が確認された場合は没収せず、運営が繰越などで対応します。',
                'Expired invoices cannot be paid. Payments confirmed after the match are never forfeited; staff will carry them over.',
              )}
            </p>
          </div>
          {!snap.paymentsEnabled && (
            <p className="rounded bg-yellow-400/15 px-3 py-2 text-sm font-bold text-yellow-200">
              {L(
                '現在Lightning決済の受付を停止しています。スポンサーパスか観戦をご利用ください。',
                'Lightning payments are paused. Use a sponsored pass or watch.',
              )}
            </p>
          )}
          <button
            className="sw-btn w-full bg-amber py-3 text-lg text-navy"
            onClick={issueInvoice}
            disabled={busy || !snap.paymentsEnabled}
            data-testid="issue-invoice"
          >
            ⚡{' '}
            {L(
              `${snap.config.entryFeeSats} satsの請求書を表示`,
              `Show ${snap.config.entryFeeSats} sats invoice`,
            )}
          </button>
          <button
            className="sw-btn w-full bg-white/10 py-3"
            onClick={() => setView('pass')}
            data-testid="use-pass"
          >
            🎟 {L('スポンサーパス（無料）を使う', 'Use a sponsored pass (free)')}
          </button>
        </section>
      )}

      {view === 'invoice' && (
        <section className="sw-panel flex flex-col items-center gap-3 p-4" data-testid="invoice">
          {isMock && (
            <div className="w-full rounded-lg border-2 border-dashed border-yellow-300 bg-yellow-400/10 p-3 text-center text-sm font-bold text-yellow-200">
              {L(
                'デモモード：これはテスト用の請求書です。実際のsatsは動きません。',
                'DEMO MODE: test invoice. No real sats move.',
              )}
            </div>
          )}
          {invoice ? (
            <>
              {!isMock && (
                <QrCode
                  url={`lightning:${invoice.bolt11.toUpperCase()}`}
                  size={260}
                  label={L('Lightning請求書のQRコード', 'Lightning invoice QR')}
                />
              )}
              <p className="text-center text-2xl font-black">{invoice.amountSats} sats</p>
              <p className="text-center text-sm text-off/80" role="timer">
                {expired
                  ? L('請求書の期限が切れました', 'Invoice expired')
                  : L(
                      `支払い期限まで ${formatClock(expiresIn ?? 0)}`,
                      `Expires in ${formatClock(expiresIn ?? 0)}`,
                    )}
              </p>
              {!isMock && (
                <div className="grid w-full grid-cols-2 gap-2">
                  <button className="sw-btn bg-white/10" onClick={copy}>
                    {copied ? L('コピーしました', 'Copied') : L('請求書をコピー', 'Copy invoice')}
                  </button>
                  <a
                    className="sw-btn flex items-center justify-center bg-amber text-navy"
                    href={`lightning:${invoice.bolt11}`}
                  >
                    {L('ウォレットで開く', 'Open wallet')}
                  </a>
                </div>
              )}
              {isMock && (
                <button
                  className="sw-btn w-full bg-ok py-3 text-lg text-navy"
                  onClick={mockPay}
                  disabled={busy || expired}
                  data-testid="mock-pay"
                >
                  {L('テスト支払いを実行（モック）', 'Simulate payment (mock)')}
                </button>
              )}
              <p className="text-center text-xs text-off/70 sw-pulse">
                {L(
                  '支払いを確認しています…（数秒かかることがあります）',
                  'Waiting for payment confirmation…',
                )}
              </p>
              {expired && (
                <button
                  className="sw-btn w-full bg-amber text-navy"
                  onClick={issueInvoice}
                  disabled={busy}
                >
                  {L('新しい請求書を発行', 'Issue a new invoice')}
                </button>
              )}
            </>
          ) : (
            <p>{L('請求書を作成中…', 'Creating invoice…')}</p>
          )}
          <button className="text-sm text-off/70 underline" onClick={() => setView('choose')}>
            {L('戻る', 'Back')}
          </button>
        </section>
      )}

      {view === 'pass' && (
        <section className="sw-panel flex flex-col gap-3 p-4">
          <label htmlFor="pass" className="font-bold">
            {L('スポンサーパスのコード', 'Sponsored pass code')}
          </label>
          <input
            id="pass"
            className="sw-focus w-full rounded-lg border border-line bg-black/40 px-3 py-3 font-mono text-lg uppercase tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SW-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            data-testid="pass-code"
          />
          <button
            className="sw-btn w-full bg-ok py-3 text-navy"
            onClick={redeem}
            disabled={busy || code.trim().length < 8}
            data-testid="redeem"
          >
            {L('パスで参加する', 'Join with pass')}
          </button>
          <button className="text-sm text-off/70 underline" onClick={() => setView('choose')}>
            {L('戻る', 'Back')}
          </button>
        </section>
      )}

      {error && (
        <p className="rounded bg-danger/15 px-3 py-2 text-sm font-bold text-danger" role="alert">
          {error}
        </p>
      )}
      <button className="text-center text-sm text-off/60 underline" onClick={onCancel}>
        {L('参加をやめる（未払いなら料金はかかりません）', 'Cancel (no charge if unpaid)')}
      </button>
    </div>
  );
}
