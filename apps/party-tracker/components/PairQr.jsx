'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QrScanner from '@/components/QrScanner';
import { classifyQrPayload, encodeAnswer, encodePairUrl } from '@/lib/transport/qrSignal';

/**
 * Two-sided QR pairing for self-contained WebRTC.
 *
 * Shows gathering before the QR is drawn, and keeps the host's answer scan
 * in-page so navigation cannot destroy the RTCPeerConnection.
 */

function QrImage({ payload, alt }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!payload) return undefined;
    let cancelled = false;
    setFailed(false);
    import('qrcode')
      .then((mod) => (mod.default || mod).toDataURL(payload, {
        margin: 1,
        width: 232,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      }))
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (failed) return <p className="fine">Could not draw the QR.</p>;
  if (!src) return <div className="qrBox" aria-hidden="true" />;
  return (
    <div className="qrBox">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qrImg" src={src} alt={alt} width={232} height={232} />
    </div>
  );
}

/**
 * @param {{
 *   role: 'host' | 'joiner',
 *   origin: string,
 *   onGatherOffer: () => Promise<string>,
 *   onGatherAnswer: (offerSdp: string) => Promise<string>,
 *   onAnswerScanned?: (encoded: string) => void,
 *   initialOfferUrl?: string | null,
 *   onConnected?: () => void,
 *   onCancel?: () => void,
 * }} props
 */
export default function PairQr({
  role,
  origin,
  onGatherOffer,
  onGatherAnswer,
  onAnswerScanned,
  initialOfferUrl = null,
  onConnected,
  onCancel,
}) {
  const [phase, setPhase] = useState('gathering');
  const [offerUrl, setOfferUrl] = useState(initialOfferUrl);
  const [answerPayload, setAnswerPayload] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase('connected');
    onConnected?.();
  }, [onConnected]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (role === 'host') {
          setPhase('gathering');
          const sdp = await onGatherOffer();
          if (cancelled) return;
          const url = await encodePairUrl(origin, sdp);
          setOfferUrl(url);
          setPhase('show-offer');
          return;
        }
        setPhase('gathering');
        let offer = initialOfferUrl;
        if (!offer) {
          setPhase('scan-offer');
          return;
        }
        const kind = classifyQrPayload(offer);
        if (kind !== 'offer') throw new Error('Not a pairing offer');
        const hash = offer.lastIndexOf('#');
        const encoded = hash === -1 ? offer : offer.slice(hash + 1);
        const answerSdp = await onGatherAnswer(encoded);
        if (cancelled) return;
        const encodedAnswer = await encodeAnswer(answerSdp);
        setAnswerPayload(encodedAnswer);
        setPhase('show-answer');
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || err));
          setPhase('error');
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [role, origin, onGatherOffer, onGatherAnswer, initialOfferUrl]);

  if (phase === 'error') {
    return (
      <div>
        <p className="fine">{error || 'Pairing failed.'}</p>
        <button type="button" className="btn small" onClick={onCancel}>Close</button>
      </div>
    );
  }

  if (phase === 'gathering') {
    return (
      <div>
        <p className="fine">Gathering network paths for the QR…</p>
      </div>
    );
  }

  if (role === 'host' && phase === 'show-offer') {
    return (
      <div>
        <p className="fine">Have the other phone scan this QR, then show their answer QR back.</p>
        <QrImage payload={offerUrl} alt="WebRTC offer QR" />
        <button type="button" className="btn rect" onClick={() => setScanning(true)}>
          Scan their answer
        </button>
        {scanning && (
          <QrScanner
            onResult={(text) => {
              setScanning(false);
              if (classifyQrPayload(text) !== 'answer') {
                setError('That QR is not a pairing answer.');
                setPhase('error');
                return;
              }
              const hash = text.lastIndexOf('#');
              const raw = hash === -1 ? text : text.slice(hash + 1);
              onAnswerScanned?.(raw);
              finish();
            }}
            onCancel={() => setScanning(false)}
          />
        )}
        <button type="button" className="btn small" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  if (role === 'joiner' && phase === 'scan-offer') {
    return (
      <div>
        <p className="fine">Scan the host&apos;s offer QR, or open their pairing link.</p>
        <QrScanner
          onResult={async (text) => {
            const kind = classifyQrPayload(text);
            if (kind !== 'offer') {
              setError('That QR is not a pairing offer.');
              setPhase('error');
              return;
            }
            try {
              setPhase('gathering');
              const hash = text.lastIndexOf('#');
              const encoded = hash === -1 ? text : text.slice(hash + 1);
              const answerSdp = await onGatherAnswer(encoded);
              const encodedAnswer = await encodeAnswer(answerSdp);
              setAnswerPayload(encodedAnswer);
              setPhase('show-answer');
            } catch (err) {
              setError(String(err?.message || err));
              setPhase('error');
            }
          }}
          onCancel={onCancel}
        />
      </div>
    );
  }

  if (role === 'joiner' && phase === 'show-answer') {
    return (
      <div>
        <p className="fine">Show this QR to the host phone — they must scan it in the app.</p>
        <QrImage payload={answerPayload} alt="WebRTC answer QR" />
        <button type="button" className="btn small" onClick={finish}>Done</button>
      </div>
    );
  }

  if (phase === 'connected') {
    return <p className="fine">Paired — the direct channel is open.</p>;
  }

  return null;
}
