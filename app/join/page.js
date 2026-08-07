'use client';

/**
 * The invite-link landing route.
 *
 * The whole credential — party id, code and the key that decrypts the party —
 * lives in the URL fragment, which browsers never put on the wire. That makes
 * this necessarily a client component reading `window.location.hash` after
 * mount: a server component would be handed a URL with nothing after the `#`
 * and could only ever fail.
 *
 * It hands off rather than connecting here. A client-side navigation to `/`
 * unmounts this route, so a party opened on this page would have to be torn
 * down and rebuilt a moment later — two selection passes, two HELLOs and a
 * roster that flickers. Moving the invite into session storage and letting the
 * map page open it once is the same join with one connection.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { decodeInvite } from '@/lib/core/session';
import { normalizeCode } from '@/lib/core/ids';
import { PENDING_INVITE_KEY } from '@/lib/partyRuntime';

function JoinFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState('reading'); // reading | joining | bad
  const [code, setCode] = useState(null);

  const handoff = useCallback(
    (payload, partyCode) => {
      try {
        window.sessionStorage.setItem(PENDING_INVITE_KEY, payload);
      } catch {
        // Private mode with storage disabled: the map page can still be joined
        // by hand, so say what to type rather than dead-ending here.
        setState('bad');
        return;
      }
      setCode(partyCode);
      setState('joining');
      router.replace('/');
    },
    [router],
  );

  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const invite = decodeInvite(hash);
    if (invite) {
      handoff(hash, invite.code);
      return;
    }
    // A fragment survives a paste but not every link preview, chat client or
    // QR app. `?code=` is the lossy fallback: it costs a code lookup instead of
    // being self-contained, but it beats telling someone their link is broken.
    const fallback = normalizeCode(params.get('code') || '');
    if (fallback.length === 6) {
      handoff(fallback, fallback);
      return;
    }
    setState('bad');
  }, [handoff, params]);

  if (state === 'bad') {
    return (
      <div className="gateCard">
        <div className="gateEyebrow">Invite</div>
        <h2>That link is not readable</h2>
        <p>
          The part after the <b>#</b> carries the key to the party, and it is missing or
          damaged. Ask for the link again, or open the app and type the six-character code in
          the Party tab.
        </p>
        <button type="button" className="btn primary" onClick={() => router.replace('/')}>
          Open the map
        </button>
      </div>
    );
  }

  return (
    <div className="gateCard">
      <div className="gateEyebrow">Invite</div>
      <h2>{state === 'joining' && code ? `Joining party ${code}` : 'Reading the invite'}</h2>
      <p>
        Handing this over to the map. Your position is not sent anywhere until the party is
        actually open.
      </p>
      <p className="gateFine">Nothing after the # ever reaches a server.</p>
    </div>
  );
}

export default function JoinPage() {
  return (
    <main className="gate">
      <Suspense
        fallback={
          <div className="gateCard">
            <div className="gateEyebrow">Invite</div>
            <h2>Reading the invite</h2>
          </div>
        }
      >
        <JoinFlow />
      </Suspense>
    </main>
  );
}
