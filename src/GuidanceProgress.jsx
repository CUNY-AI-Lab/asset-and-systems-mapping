import { useEffect, useState } from 'react';

// The server reports coarse states (saving, reading, retrying); the figure
// shows an approximate position between them so the wait reads as movement.
// It never reaches the end on its own: completion comes from the result.
const PHASES = [
  { until: 3, label: 'Saving' },
  { until: 12, label: 'Reading memo' },
  { until: 28, label: 'Checking quotes' },
  { until: 55, label: 'Rechecking' },
  { until: Infinity, label: 'Still working' },
];

export function phaseFor(elapsedSeconds, message = '') {
  if (/retry|interruption|reconnect|recover/i.test(message)) return 'Rechecking';
  return PHASES.find(phase => elapsedSeconds < phase.until).label;
}

/** Asymptotic progress: fast at first, slowing toward 95% while the model works. */
export function approximateProgress(elapsedSeconds) {
  return Math.min(95, Math.round(100 * (1 - Math.exp(-elapsedSeconds / 18))));
}

export default function GuidanceProgress({ active, message }) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    setStartedAt(started);
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const percent = approximateProgress(elapsed);
  const label = phaseFor(elapsed, message);
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
