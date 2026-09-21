/**
 * QR decoder selection for QrScanner.
 *
 * Platform BarcodeDetector when available; lazy jsQR only in pairing mode.
 * The join path stays honest-unsupported on iOS — no WASM decoder there.
 */

const defaultLoadJsQr = async () => {
  const mod = await import('jsqr');
  return mod.default || mod;
};

function decodeWithJsQr(jsQR, imageData) {
  const hit = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  });
  return hit?.data ?? null;
}

/**
 * @param {{
 *   pairingMode?: boolean,
 *   BarcodeDetector?: typeof globalThis.BarcodeDetector,
 *   loadJsQr?: () => Promise<(data: Uint8ClampedArray, width: number, height: number, options?: object) => { data: string } | null>,
 * }} opts
 * @returns {Promise<{
 *   kind: 'platform' | 'jsqr' | 'unsupported',
 *   detector?: {
 *     detect: (video: { readyState?: number, videoWidth?: number, videoHeight?: number, drawImage?: never }) => Promise<string | null>,
 *     decodeImageData?: (imageData: { data: Uint8ClampedArray, width: number, height: number }) => string | null,
 *   },
 * }>}
 */
export async function createQrDetector({
  pairingMode = false,
  BarcodeDetector: Detector = globalThis.BarcodeDetector,
  loadJsQr = defaultLoadJsQr,
} = {}) {
  if (typeof Detector === 'function') {
    try {
      const formats = await Detector.getSupportedFormats?.();
      if (Array.isArray(formats) && !formats.includes('qr_code')) {
        /* fall through to jsQR or unsupported */
      } else {
        const detector = new Detector({ formats: ['qr_code'] });
        return {
          kind: 'platform',
          detector: {
            async detect(video) {
              const codes = await detector.detect(video);
              const hit = codes?.find?.((c) => c?.rawValue);
              return hit?.rawValue ?? null;
            },
          },
        };
      }
    } catch {
      /* try jsQR or unsupported */
    }
  }

  if (!pairingMode) {
    return { kind: 'unsupported' };
  }

  const jsQR = await loadJsQr();
  return {
    kind: 'jsqr',
    detector: {
      decodeImageData(imageData) {
        return decodeWithJsQr(jsQR, imageData);
      },
      async detect(video) {
        if (!video || (video.readyState ?? 0) < 2) return null;
        const width = video.videoWidth ?? 0;
        const height = video.videoHeight ?? 0;
        if (!width || !height) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        return decodeWithJsQr(jsQR, imageData);
      },
    },
  };
}
