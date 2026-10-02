import { useEffect, useState } from 'react';

// Geometry follows the loaded font, including a late font-display:swap.
// This is rare state; pointer movement never performs DOM text measurement.
export function useMapFontMetrics() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return undefined;
    let active = true;
    const remeasure = () => { if (active) setRevision(value => value + 1); };
    fonts.addEventListener?.('loadingdone', remeasure);
    fonts.addEventListener?.('loadingerror', remeasure);
    if (fonts.status === 'loading') Promise.resolve(fonts.ready).then(remeasure, remeasure);
    return () => {
      active = false;
      fonts.removeEventListener?.('loadingdone', remeasure);
      fonts.removeEventListener?.('loadingerror', remeasure);
    };
  }, []);
  return revision;
}
