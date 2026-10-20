import { useEffect, useRef } from 'react';

// Read-only lists refresh while their panel and browser tab are visible.
// Callers retain their own authorization, in-flight and editable-draft guards.
export function useVisibleRefresh(refresh, active = true) {
  const current = useRef(refresh);
  current.current = refresh;
  useEffect(() => {
    if (!active) return undefined;
    const update = () => { if (document.visibilityState !== 'hidden') current.current(); };
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [active]);
}
