import { useEffect, useRef } from 'react';

export interface ExportWarningData {
  readonly filename: string;
  readonly problem: string;
}

export function ExportWarning({
  warning,
  onDismiss,
}: {
  readonly warning: ExportWarningData;
  readonly onDismiss: () => void;
}) {
  const warningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    warningRef.current?.scrollIntoView({ block: 'nearest' });
  }, [warning]);
  return (
    <div ref={warningRef} className="notice-error export-warning">
      <p role="alert">
        The downloaded backup <strong>{warning.filename}</strong> cannot be re-imported.{' '}
        {warning.problem}
      </p>
      <button type="button" className="btn btn-outline btn-small" onClick={onDismiss}>
        Dismiss export warning
      </button>
    </div>
  );
}
