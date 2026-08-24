'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Refreshes the Library while an article is still being analysed.
 *
 * The page is `force-dynamic`, so `router.refresh()` re-runs the server
 * component and the progress moves without a full navigation -- no API route, no
 * client-side copy of the state, and the numbers stay computed in exactly one
 * place.
 *
 * Rendered only when something is actually pending, so it unmounts itself the
 * moment the last article becomes readable and the polling stops. An idle
 * Library costs nothing.
 */
export function AnalysisPoller({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    // Nothing to show while the tab is hidden, and a background tab polling a
    // local model host is pure waste.
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
