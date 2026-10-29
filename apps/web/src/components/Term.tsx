'use client';
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/** Plain-language explanations for jargon (spec E5), opened by tap or keyboard. */
export const TERMS = {
  lightning: {
    ja: 'Lightning＝ビットコインの少額決済の仕組み。数円から素早く払えます。',
    en: 'Lightning = a way to send small Bitcoin payments quickly.',
  },
  auth: {
    ja: '認証＝ウォレットの中の自分の鍵でログインすること。本人確認ではなく、秘密鍵やシードを渡すこともありません。',
    en: 'Login with your wallet key. Not an identity check; you never hand over keys or seeds.',
  },
  sats: {
    ja: 'sats（サッツ）＝ビットコインの最小単位。1億sats＝1BTC。',
    en: 'sats = the smallest Bitcoin unit (100 million sats = 1 BTC).',
  },
  sync: {
    ja: 'SYNC＝雷神と風神の連携の強さ。ちがう席の仲間が20秒以内に続けて成功すると上がります。',
    en: 'SYNC = how well Raijin and Fujin work together; rises when different seats succeed within 20 s.',
  },
} as const;

export function Term({ k, children }: { k: keyof typeof TERMS; children: React.ReactNode }) {
  const { L } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = L(TERMS[k].ja, TERMS[k].en);
  return (
    <span className="inline-block max-w-full align-top">
      <button
        type="button"
        className="sw-focus cursor-help underline decoration-dotted underline-offset-4"
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </button>
      {/* Inline (not floating) so it can never push a 320px screen sideways. */}
      <span
        id={id}
        role="tooltip"
        className={
          open
            ? 'mt-1 block max-w-[16rem] rounded-lg border border-line bg-navy-2 p-2 text-xs font-normal text-off'
            : 'sr-only'
        }
      >
        {text}
      </span>
    </span>
  );
}
