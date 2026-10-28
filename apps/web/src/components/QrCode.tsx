'use client';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Renders a QR for a URL that comes from server configuration (never user input). */
export function QrCode({
  url,
  size = 220,
  label,
  caption = true,
}: {
  url: string;
  size?: number;
  label?: string;
  /** Print the URL under the code (off for long payment requests). */
  caption?: boolean;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#070D1A', light: '#FFFFFF' },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        className="rounded-lg bg-white p-2"
        style={{ width: size, height: size }}
        role="img"
        aria-label={label ?? url}
        // qrcode output is generated locally from a configured URL.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      {caption && (
        <figcaption className="max-w-[260px] break-all text-center text-sm font-bold text-off/90">
          {url.replace(/^https?:\/\//, '')}
        </figcaption>
      )}
    </figure>
  );
}
