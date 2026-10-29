'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AchievementsResponse, CosmeticSlot, PassportResponse } from '@sats-wars/shared';
import {
  COSMETIC_SLOTS,
  PASSPORT_CARD_SIZE,
  passportCardInput,
  passportCardSvg,
} from '@sats-wars/shared';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const SLOT_LABELS: Record<CosmeticSlot, { ja: string; en: string }> = {
  HELMET: { ja: 'ヘルメット', en: 'Helmet' },
  VISOR: { ja: 'バイザー', en: 'Visor' },
  SUIT: { ja: '操縦服', en: 'Flight suit' },
  COCKPIT_FX: { ja: '座席の光', en: 'Seat light' },
  LICENSE_BG: { ja: 'ライセンス背景', en: 'License background' },
};

/** SVG → PNG in the browser (no upload: the image never leaves the device). */
async function svgToPng(svg: string): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = PASSPORT_CARD_SIZE.width;
  canvas.height = PASSPORT_CARD_SIZE.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'),
  );
}

/**
 * The shareable license image (spec C10) and the cosmetics locker. The image
 * is drawn locally from the passport; saving or sharing is the pilot's own
 * action (no automatic posting anywhere).
 */
export function LicenseCard({
  data,
  onChanged,
}: {
  data: PassportResponse;
  onChanged: () => Promise<void>;
}) {
  const { L, locale } = useI18n();
  const [anonymous, setAnonymous] = useState(!data.pilot.showNameOnArena);
  const [ach, setAch] = useState<AchievementsResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const loadAch = useCallback(async () => {
    try {
      setAch(await api<AchievementsResponse>('/api/me/achievements'));
    } catch {
      setAch(null);
    }
  }, []);
  useEffect(() => {
    void loadAch();
  }, [loadAch, data]);

  const svg = useMemo(
    () => passportCardSvg(passportCardInput(data, { anonymous, locale, now: Date.now() })),
    [data, anonymous, locale],
  );
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const save = async () => {
    setMsg(null);
    try {
      const png = await svgToPng(svg);
      const file = new File([png], 'sats-wars-pilot-license.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && /Mobi|Android|iPhone/.test(navigator.userAgent)) {
        await nav.share({ files: [file], title: 'SATS WARS: EARTH DEFENSE' });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(L('画像を保存しました', 'Image saved'));
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setMsg(L('画像を作れませんでした', 'Could not create the image'));
    }
  };

  const equip = async (slot: CosmeticSlot, id: string) => {
    setMsg(null);
    try {
      await api('/api/me', { method: 'PATCH', body: { equip: { [slot]: id } } });
      await onChanged();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <section className="sw-panel flex flex-col gap-3 p-4" data-testid="license-card">
      <h2 className="font-black">{L('ライセンス画像', 'License image')}</h2>
      <img
        src={src}
        alt={L(
          `${data.pilot.callsign} のパイロットライセンス`,
          `Pilot license of ${data.pilot.callsign}`,
        )}
        className="w-full rounded-xl border border-line"
        width={PASSPORT_CARD_SIZE.width}
        height={PASSPORT_CARD_SIZE.height}
        data-testid="license-card-image"
      />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
          data-testid="license-anonymous"
        />
        {L(
          `匿名で作る（${data.pilot.pseudonym} と表示）`,
          `Anonymous (shows ${data.pilot.pseudonym})`,
        )}
      </label>
      <button
        type="button"
        className="sw-btn bg-amber text-navy"
        onClick={() => void save()}
        data-testid="license-save"
      >
        ⬇ {L('画像を保存・共有（PNG）', 'Save / share image (PNG)')}
      </button>
      {msg && (
        <p className="text-sm text-muted" role="status">
          {msg}
        </p>
      )}

      <h3 className="mt-2 font-black">
        {L('装飾（見た目だけ・強さは変わりません）', 'Cosmetics (looks only — no power)')}
      </h3>
      {!ach ? (
        <p className="text-sm text-muted">{L('読み込み中…', 'Loading…')}</p>
      ) : (
        COSMETIC_SLOTS.map((slot) => (
          <fieldset key={slot} className="flex flex-col gap-1" data-testid={`locker-${slot}`}>
            <legend className="text-sm font-bold">
              {L(SLOT_LABELS[slot].ja, SLOT_LABELS[slot].en)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {ach.cosmetics
                .filter((c) => c.slot === slot)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!c.unlocked}
                    aria-pressed={c.equipped}
                    onClick={() => void equip(slot, c.id)}
                    className={`sw-focus flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs ${
                      c.equipped ? 'border-amber bg-navy-3' : 'border-line'
                    } ${c.unlocked ? '' : 'opacity-50'}`}
                    title={c.unlocked ? undefined : c.hint}
                    data-testid={`cosmetic-${c.id}`}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-5 w-5 rounded-full border"
                      style={{ background: c.color, borderColor: c.accent }}
                    />
                    <span>
                      {L(c.ja, c.en)}
                      {c.rarity === 'EVENT' && ' 🎪'}
                      {c.rarity === 'RARE' && ' ✦'}
                      <br />
                      <span className="text-muted">
                        {c.equipped
                          ? L('装備中', 'Equipped')
                          : c.unlocked
                            ? L('装備する', 'Equip')
                            : `🔒 ${c.hint}`}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </fieldset>
        ))
      )}
    </section>
  );
}
