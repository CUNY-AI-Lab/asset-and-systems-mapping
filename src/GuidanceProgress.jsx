import { useEffect, useState } from 'react';

// Only explicit request status changes the label. Elapsed time is not evidence
// that the model has reached validation or begun a corrective call.
export function phaseFor(_elapsedSeconds, message = '', scale) {
  if (/^Saving/i.test(message)) return 'Saving request';
  if (/^Recovering/i.test(message)) return 'Recovering request';
  if (/Retrying/i.test(message)) return 'Waiting to retry';
  if (scale === 'exosphere') return 'Contextualizing scales';
  return ['meso', 'macrosphere'].includes(scale) ? 'Identifying relationships' : scale ? 'Classifying nodes' : 'Generating guidance';
}

/** Asymptotic progress: fast at first, slowing toward 95% while the model works. */
export function approximateProgress(elapsedSeconds) {
  return Math.min(95, Math.round(100 * (1 - Math.exp(-elapsedSeconds / 18))));
}

export default function GuidanceProgress({ active, message, scale }) {
  const [elapsed, setElapsed] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const percent = approximateProgress(elapsed);
  const label = phaseFor(elapsed, message, scale);
  return (
    <div className="guidance-progress">
      <button type="button" className="guidance-progress__figure" aria-expanded={open} onClick={() => setOpen(!open)}
        title={message || label}>
        <span className="guidance-progress__track" role="progressbar" aria-label="Guidance progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${label}, about ${percent} percent`}>
          <span className="guidance-progress__fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="guidance-progress__label">{label}</span>
      </button>
      <p role="status" className={open ? 'guidance-progress__detail' : 'sr-only'}>
        {message || label}{open && elapsed >= 5 ? ` · ${elapsed}s` : ''}
      </p>
    </div>
  );
}
