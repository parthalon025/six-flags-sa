'use client';

import { useEffect, useState } from 'react';

/* Android/Chrome fires beforeinstallprompt and we can show a real button.
   iOS Safari never fires it and has no API, so the only honest thing is to
   describe the two taps. Both are hidden once the app is already standalone. */

export default function InstallCard() {
  const [deferred, setDeferred] = useState(null);
  const [platform, setPlatform] = useState('other');
  const [standalone, setStandalone] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
    setPlatform(isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'other');
    setStandalone(
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    );
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setDone(true));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (standalone || done) {
    return (
      <p className="fine">
        Installed. It runs full screen and the park map works with no signal — handy in a
        queue line where the wifi gives up.
      </p>
    );
  }

  return (
    <div className="installCard">
      {deferred ? (
        <>
          <p className="fine" style={{ margin: '0 0 10px' }}>
            Add it to your home screen so it opens full screen and works offline.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              deferred.prompt();
              const { outcome } = await deferred.userChoice;
              if (outcome === 'accepted') setDone(true);
              setDeferred(null);
            }}
          >
            Add to home screen
          </button>
        </>
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
        Installing caches the whole park map on the phone, so it draws instantly and keeps
        working when the signal drops. Location and party sync still need a connection.
      </p>
    </div>
  );
}
