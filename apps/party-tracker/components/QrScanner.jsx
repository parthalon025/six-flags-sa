'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera join, using the platform's own barcode decoder.
 *
 * `BarcodeDetector` is hardware-accelerated where it exists (Chrome and the
 * Android WebView) and absent where it does not — notably every browser on
 * iOS, which is a large share of a park. The honest answer there is to say so
 * and point at the six-character code, not to ship a WASM decoder that turns a
 * phone's camera into a space heater for the one thing the code already does.
 *
 * Whatever happens, every track this component opened is stopped when it goes
 * away: a camera light left on is the most alarming bug a park app can have.
 */

const SCAN_INTERVAL_MS = 220;

export default function QrScanner({ onResult, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const doneRef = useRef(false);
  const [state, setState] = useState('starting'); // starting | scanning | unsupported | error
  const [detail, setDetail] = useState(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
    for (const track of streamRef.current?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {
        /* already ended */
      }
    }
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function begin() {
      if (typeof window === 'undefined') return;
      const Detector = window.BarcodeDetector;
      if (typeof Detector !== 'function') {
        setState('unsupported');
        return;
      }
      try {
        const formats = await Detector.getSupportedFormats?.();
        if (Array.isArray(formats) && !formats.includes('qr_code')) {
          setState('unsupported');
          return;
        }
      } catch {
        /* an implementation that will not enumerate still gets a try below */
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported');
        return;
      }

      let detector;
      try {
        detector = new Detector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play().catch(() => null);
        setState('scanning');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setDetail(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was refused.'
            : 'No camera this app can open.',
        );
        return;
      }

      timerRef.current = setInterval(async () => {
        const video = videoRef.current;
        if (!video || doneRef.current || video.readyState < 2) return;
        let codes = [];
        try {
          codes = await detector.detect(video);
        } catch {
          return; // a dropped frame is not a failure worth reporting
        }
        const hit = codes.find((c) => c?.rawValue);
        if (!hit) return;
        doneRef.current = true;
        stop();
        onResult?.(hit.rawValue);
      }, SCAN_INTERVAL_MS);
    }

    begin();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onResult, stop]);

  if (state === 'unsupported') {
    return (
      <div className="scanner">
        <p className="fine" style={{ marginTop: 0 }}>
          This browser has no barcode decoder — that is every browser on iOS, because they all
          run Safari&apos;s engine and it does not expose one. Ask for the six-character code and
          type it in, or open the invite link directly.
        </p>
        <button type="button" className="btn small" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="scanner">
      <video ref={videoRef} className="scannerView" muted playsInline />
      <p className="fine" style={{ marginTop: 0 }}>
        {state === 'error' ? detail : "Point the camera at the other phone's QR."}
      </p>
      <button type="button" className="btn small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
