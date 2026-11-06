/**
 * Leitura de QR Code a partir de imagem (foto) ou de quadros da câmera, 100% local
 * (jsQR). O iOS não oferece BarcodeDetector, por isso a decodificação é em JS.
 */
import jsQR from 'jsqr';

const MAX_SIDE = 1200;

/** Tenta ler um QR de um elemento desenhável. Retorna o texto ou null. */
export function decodeFrom(source: CanvasImageSource, width: number, height: number, canvas?: HTMLCanvasElement): string | null {
  const c = canvas ?? document.createElement('canvas');
  // Tenta no tamanho reduzido (rápido) e, se falhar, maior (cupom pequeno na foto).
  for (const max of [800, MAX_SIDE, 1800]) {
    const scale = Math.min(1, max / Math.max(width, height));
    c.width = Math.max(1, Math.round(width * scale));
    c.height = Math.max(1, Math.round(height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
    if (scale === 1) break;
  }
  return null;
}

export async function decodeFile(file: File): Promise<string | null> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Imagem grande demais');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return decodeFrom(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
