'use client';

/**
 * Self-contained pairing landing — offer URL in the fragment.
 *
 * Joiners can open this from the stock camera app. The host must scan the
 * answer in-page; see PairQr and docs/HANDOFF-self-contained.md.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { classifyQrPayload } from '@/lib/transport/qrSignal';
const PAIR_OFFER_KEY = 'ki-pending-pair-offer';

export function stashPendingPairOffer(payload) {
  if (typeof window === 'undefined' || !payload) return false;
  try {
    window.sessionStorage.setItem(PAIR_OFFER_KEY, String(payload));
    return true;
  } catch {
    return false;
  }
}

function PairFlow() {
  const router = useRouter();
  const [state, setState] = useState('reading'); // reading | ready | bad

  const accept = useCallback((hash) => {
    if (classifyQrPayload(hash) !== 'offer') {
      setState('bad');
      return;
    }
    stashPendingPairOffer(hash);
    setState('ready');
  }, []);

  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    if (!hash || hash === '#') {
      setState('bad');
      return;
    }
    accept(hash);
  }, [accept]);

  if (state === 'bad') {
    return (
      <div className="gateCard">
        <div className="gateEyebrow">Pair</div>
        <h2>That pairing link is not readable</h2>
        <p>The offer lives in the part after the <b>#</b>. Ask the host to show the QR again.</p>
        <button type="button" className="btn primary" onClick={() => router.replace('/')}>
          Open the map
        </button>
      </div>
    );
  }

  return (
    <div className="gateCard">
      <div className="gateEyebrow">Pair</div>
      <h2>Offer received</h2>
      <p>Open the map to finish pairing on the same hotspot. The host will scan your answer QR in the app.</p>
      <button type="button" className="btn primary" onClick={() => router.replace('/')}>
        Continue
      </button>
    </div>
  );
}

export default function PairPage() {
  return (
    <main className="gate">
      <Suspense
        fallback={
          <div className="gateCard">
            <div className="gateEyebrow">Pair</div>
            <h2>Reading the offer</h2>
          </div>
        }
      >
        <PairFlow />
      </Suspense>
    </main>
  );
}
