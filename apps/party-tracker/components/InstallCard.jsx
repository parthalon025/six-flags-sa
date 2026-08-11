'use client';

import { useEffect, useState } from 'react';
import {
  clearInstallDismissed,
  hasInstalledRelatedApp,
  isRunningAsInstalledApp,
  markInstallDismissed,
  readInstallDismissed,
} from '@/lib/install';

/**
 * Install pitch.
 *
 * `compact` — welcome gate, paired with GPS. Hidden when already installed,
 * after a soft dismiss, or when the browser cannot install (desktop without
 * beforeinstallprompt and not iOS/Android). Uses outcome-focused copy, not
 * "install our app".
 *
 * Full card — Me → This Phone. Still silent when already installed.
 */

export default function InstallCard({ compact = false }) {
  const [deferred, setDeferred] = useState(null);
  const [platform, setPlatform] = useState('other');
  const [installed, setInstalled] = useState(true); // assume installed until checked — no flash of CTA
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
    const isAndroid = /Android/.test(ua);
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other');

    let cancelled = false;
    (async () => {
      const local = isRunningAsInstalledApp();
      const related = local ? false : await hasInstalledRelatedApp();
      if (cancelled) return;
      setInstalled(local || related);
      setDismissed(compact ? readInstallDismissed() : false);
      setReady(true);
    })();

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setDone(true);
      setInstalled(true);
      clearInstallDismissed();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [compact]);

  const alreadyHome = installed || done;

  if (!ready) return null;

  if (alreadyHome) {
    if (compact) return null;
    return (
      <p className="fine">
        On your Home Screen — full screen, and the park map still draws when the wifi dies in a
        queue.
      </p>
    );
  }

  const promptInstall = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') {
      setDone(true);
      setInstalled(true);
      clearInstallDismissed();
    } else {
      markInstallDismissed();
      setDismissed(true);
    }
    setDeferred(null);
  };

  const dismiss = () => {
    markInstallDismissed();
    setDismissed(true);
  };

  /* —— Welcome gate: one persuasive line + CTA, dismissible, never duplicates —— */
  if (compact) {
    if (dismissed) return null;

    if (deferred) {
      return (
        <div className="gateInstallPitch">
          <p className="gateInstallHook">
            Midway wifi dies in the queue. Put Parkbound on your Home Screen and the map stays
            with you offline.
          </p>
          <button type="button" className="btn" onClick={promptInstall}>
            Keep the map offline
          </button>
          <button type="button" className="btnQuiet gateInstallSkip" onClick={dismiss}>
            Not now
          </button>
        </div>
      );
    }

    if (platform === 'ios') {
      return (
        <div className="gateInstallPitch">
          <p className="gateInstallHook">
            Midway wifi dies in the queue. Add Parkbound to your Home Screen so the map stays
            offline — full screen, one tap from your pocket.
          </p>
          {!iosOpen ? (
            <>
              <button type="button" className="btn" onClick={() => setIosOpen(true)}>
                Show me how
              </button>
              <button type="button" className="btnQuiet gateInstallSkip" onClick={dismiss}>
                Not now
              </button>
            </>
          ) : (
            <>
              <ol className="steps gateInstallSteps">
                <li>
                  Tap <b>Share</b> in Safari
                </li>
                <li>
                  <b>Add to Home Screen</b>
                </li>
                <li>
                  Tap <b>Add</b>
                </li>
              </ol>
              <button type="button" className="btnQuiet gateInstallSkip" onClick={dismiss}>
                Done / not now
              </button>
            </>
          )}
        </div>
      );
    }

    if (platform === 'android') {
      return (
        <div className="gateInstallPitch">
          <p className="gateInstallHook">
            Midway wifi dies in the queue. Add Parkbound to your Home Screen so the map stays
            offline.
          </p>
          <p className="gateInstallHint">
            Browser menu <b>⋮</b> → <b>Add to Home screen</b> or <b>Install app</b>
          </p>
          <button type="button" className="btnQuiet gateInstallSkip" onClick={dismiss}>
            Not now
          </button>
        </div>
      );
    }

    return null;
  }

  /* —— Settings: fuller pitch when not installed —— */
  return (
    <div className="installCard">
      <p className="installHook">
        When the park wifi drops mid-queue, the Home Screen app still has the map. Full screen —
        no browser chrome eating the midway.
      </p>
      {deferred ? (
        <button type="button" className="btn primary" onClick={promptInstall}>
          Keep the map offline
        </button>
      ) : platform === 'ios' ? (
        <ol className="steps">
          <li>
            Tap <b>Share</b> at the bottom of Safari
          </li>
          <li>
            Scroll and tap <b>Add to Home Screen</b>
          </li>
          <li>
            Tap <b>Add</b>
          </li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            Open the browser menu <b>⋮</b>
          </li>
          <li>
            Tap <b>Add to Home screen</b> or <b>Install app</b>
          </li>
        </ol>
      )}
      <p className="fine">
        Location and party sync still need a connection. The drawn park map does not.
      </p>
    </div>
  );
}
