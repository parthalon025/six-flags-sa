'use client';

import { useEffect, useState } from 'react';
import { APP_BUILT, APP_VERSION } from '@/lib/version';
import { watchAppUpdates } from '@/lib/appUpdate';

/**
 * Poll for a newer build when the phone is online; stay on the cached shell
 * when it is not. Returns the local version and the last probe status for
 * diagnostics.
 */
export default function useAppUpdate() {
  const [status, setStatus] = useState('idle');
  const [remoteVersion, setRemoteVersion] = useState(null);
  const [remoteBuilt, setRemoteBuilt] = useState(null);

  useEffect(() => {
    let stop = () => {};
    watchAppUpdates({
      onStatus: (next, detail = {}) => {
        setStatus(next);
        if (detail.remote) setRemoteVersion(detail.remote);
        if (detail.remoteBuilt) setRemoteBuilt(detail.remoteBuilt);
      },
    }).then((cleanup) => {
      stop = cleanup;
    });
    return () => stop();
  }, []);

  return { version: APP_VERSION, built: APP_BUILT, remoteVersion, remoteBuilt, status };
}
