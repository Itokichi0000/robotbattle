/**
 * Small HUD pieces shared by the phone and the venue screen. Every value is
 * shown as a number + text, never colour alone.
 */

function Pips({ filled, total, color, label }: { filled: number; total: number; color: string; label: string }) {
  return (
    <span className="inline-flex gap-[3px] align-middle" role="meter" aria-label={label} aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="inline-block h-[0.7em] w-[0.7em] rounded-full ring-1 ring-white/25"
          style={{ background: i < filled ? color : 'rgba(0,0,0,0.45)' }}
        />
      ))}
    </span>
  );
}

/** "敵ターンまで あと N手": the aliens move after every `total` paid actions. */
export function TurnGauge({ left, total, locale }: { left: number; total: number; locale: 'ja' | 'en' }) {
  const ja = locale === 'ja';
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 font-bold" data-testid="turn-gauge">
      <span>
        {ja ? '敵ターンまで あと' : 'Alien turn in '}
        <span className="sw-display mx-0.5 text-[1.5em] text-white tabular-nums">{left}</span>
        {ja ? '手' : left === 1 ? ' move' : ' moves'}
      </span>
      <Pips filled={total - left} total={total} color="#B65CFF" label={ja ? '敵ターンゲージ' : 'Alien turn gauge'} />
    </span>
  );
}

export function ComboGauge({ combo, max, locale }: { combo: number; max: number; locale: 'ja' | 'en' }) {
  const ja = locale === 'ja';
  const ready = combo >= max;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 font-bold" data-testid="combo-gauge">
      <span className={ready ? 'text-yellow-300' : ''}>
        💥 {ready ? (ja ? '合体技 発動OK！' : 'Combo READY!') : ja ? `合体ゲージ ${combo}/${max}` : `Combo ${combo}/${max}`}
      </span>
      {!ready && (
        <span className="inline-block h-2 w-20 overflow-hidden rounded bg-black/50 ring-1 ring-white/20">
          <span className="block h-full bg-yellow-300" style={{ width: `${(combo / max) * 100}%` }} />
        </span>
      )}
    </span>
  );
}

/** Captured regions vs. the limit at which Japan falls. */
export function FallMeter({ fallen, limit, locale }: { fallen: number; limit: number; locale: 'ja' | 'en' }) {
  const ja = locale === 'ja';
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 font-bold" data-testid="fall-meter">
      <span>
        👾 {ja ? `とられた ${fallen}/${limit}` : `Captured ${fallen}/${limit}`}
      </span>
      <Pips filled={fallen} total={limit} color="#B65CFF" label={ja ? 'とられた地方' : 'Captured regions'} />
    </span>
  );
}
