'use client';

import { useEffect, useState } from 'react';
import { isSupported, storedIds } from '../lib/offline/store.ts';

/**
 * A way into the offline shelf, shown only once there is something on it.
 *
 * Otherwise the Library would carry a permanent link to an empty page, and the
 * feature would advertise itself to a reader who has never used it and cannot
 * tell from the label what it would do. The download button in the reader is
 * where you meet this first; this is how you get back.
 */
export function OfflineShelfLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isSupported()) return;
    let live = true;
    void storedIds()
      .then((ids) => {
        if (live) setCount(ids.size);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (count === 0) return null;

  return (
    <p className="note">
      <a href="/offline">離線書櫃</a>：{count} 章可在沒有網路時閱讀。
    </p>
  );
}
