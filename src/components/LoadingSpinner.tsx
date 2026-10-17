import type { CSSProperties } from 'react';
import './loading-spinner.css';

/** Four squares slide inside their original forward-slash footprint. */
export default function LoadingSpinner({ size = 48 }: { size?: number }) {
  return <span className="loading-spinner" style={{ '--spinner-size': `${size}px` } as CSSProperties} aria-hidden="true">
    <span /><span /><span /><span />
  </span>;
}
