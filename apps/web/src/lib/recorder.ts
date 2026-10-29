/**
 * Browser-side highlight recording (spec C9: 決定論的イベントリプレイ＋
 * ブラウザ録画導線). Copies the 3D canvas plus a caption overlay into a 2D
 * canvas each frame and records it with MediaRecorder. Nothing is uploaded:
 * the file is handed to the user to save.
 */
export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? 'video/webm';
}

export interface RecordOptions {
  source: HTMLCanvasElement;
  seconds: number;
  /** Draws captions on top of the copied frame (clock, banner, title). */
  overlay: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  width?: number;
  height?: number;
  fps?: number;
}

export async function recordCanvas(o: RecordOptions): Promise<{ blob: Blob; mimeType: string }> {
  const w = o.width ?? 1280;
  const h = o.height ?? 720;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const stream = out.captureStream(o.fps ?? 30);
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  let raf = 0;
  const draw = () => {
    ctx.fillStyle = '#070D1A';
    ctx.fillRect(0, 0, w, h);
    // Letterbox the source into 16:9.
    const sw = o.source.width;
    const sh = o.source.height;
    const scale = Math.min(w / sw, h / sh);
    ctx.drawImage(o.source, (w - sw * scale) / 2, (h - sh * scale) / 2, sw * scale, sh * scale);
    o.overlay(ctx, w, h);
    raf = requestAnimationFrame(draw);
  };
  draw();
  rec.start(250);
  await new Promise((r) => setTimeout(r, o.seconds * 1000));
  rec.stop();
  cancelAnimationFrame(raf);
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: mimeType }), mimeType };
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
