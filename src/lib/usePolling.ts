import { useEffect, useRef } from 'react';

// Every poll hits Cloudflare D1, whose free tier caps rows read per day. So polling
// only runs while the tab is visible, and a tab coming back into view refreshes once
// (if the last run is older than `intervalMs`) instead of hammering in the background.
export function usePolling(fn: () => unknown, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    if (!enabled) return;
    let lastRun = Date.now();
    const run = () => {
      if (document.hidden) return;
      lastRun = Date.now();
      void fnRef.current();
    };
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRun >= intervalMs) run();
    };
    const iv = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
