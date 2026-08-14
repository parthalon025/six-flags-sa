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
 * Name-before-join: ask what the family should call this phone, then hand the
 * invite (+ name) to `/` via session storage so the map page joins once.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { decodeInvite } from '@/lib/core/session';
import { normalizeCode } from '@/lib/core/ids';
import { stashPendingInvite } from '@/lib/party/inviteStash';

function JoinFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState('reading'); // reading | name | joining | bad
  const [code, setCode] = useState(null);
  const [payload, setPayload] = useState(null);
  const [name, setName] = useState('');

  const acceptInvite = useCallback((invitePayload, partyCode) => {
    setPayload(invitePayload);
    setCode(partyCode);
    setState('name');
  }, []);

  const handoff = useCallback(() => {
    if (!payload) return;
    const clean = name.trim();
    if (!stashPendingInvite(payload, clean)) {
      setState('bad');
      return;
    }
    setState('joining');
    router.replace('/');
  }, [payload, name, router]);

  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const invite = decodeInvite(hash);
    if (invite) {
      acceptInvite(hash, invite.code);
      return;
    }
    // A fragment survives a paste but not every link preview, chat client or
    // QR app. `?code=` is the lossy fallback: it costs a code lookup instead of
    // being self-contained, but it beats telling someone their link is broken.
    const fallback = normalizeCode(params.get('code') || '');
    if (fallback.length === 6) {
      acceptInvite(fallback, fallback);
      return;
    }
    setState('bad');
  }, [acceptInvite, params]);

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

  if (state === 'name' && code) {
    const named = Boolean(name.trim());
    return (
      <div className="gateCard">
        <div className="gateEyebrow">Invite · {code}</div>
        <h2>What should the family call you?</h2>
        <p>This is the name beside your dot on everyone else&apos;s map.</p>
        <input
          className="field"
          maxLength={14}
          placeholder="Your name"
          aria-label="Your name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handoff();
          }}
        />
        <button type="button" className="btn primary" onClick={handoff}>
          {named ? `Join party ${code}` : 'Join as Guest'}
        </button>
        <p className="gateFine">
          {named
            ? 'Next we open the map and put you in the party.'
            : 'You can join as Guest, then rename under Me.'}
        </p>
      </div>
    );
  }

  return (
    <div className="gateCard">
      <div className="gateEyebrow">Invite</div>
      <h2>{state === 'joining' && code ? `Joining party ${code}` : 'Reading the invite'}</h2>
      <p>
        {state === 'joining'
          ? 'Handing this over to the map — you will land on Party so you can see the family.'
          : 'Checking the invite link.'}
      </p>
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
