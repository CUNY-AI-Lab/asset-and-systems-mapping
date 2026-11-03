import { useEffect, useState } from 'react';

// Geometry follows the loaded font, including a late font-display:swap.
// This is rare state; pointer movement never performs DOM text measurement.
export function useMapFontMetrics() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return undefined;
    let active = true;
    const remeasure = (event) => {
      // Editor italics and prose fonts do not change the canvas labels. Their
      // lazy loading must not invalidate geometry or a student's chosen view.
      if (event?.fontfaces?.length && !event.fontfaces.some(face => (
        face.style === 'normal'
        && ['source sans 3 variable', 'source sans 3'].includes(face.family.replace(/["']/g, '').toLowerCase())
      ))) return;
      if (active) setRevision(value => value + 1);
    };
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
