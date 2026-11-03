import { useEffect, useRef } from 'react';

export interface ExportFailureData {
  readonly message: string;
  readonly attempt: number;
}

export function ExportFailure({
  failure,
  onDismiss,
}: {
  readonly failure: ExportFailureData;
  readonly onDismiss: () => void;
}) {
  const warningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    warningRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [failure]);
  return (
    <div ref={warningRef} className="notice-error export-failure">
      <p key={failure.attempt} role="alert">
        We could not start the export. {failure.message}
      </p>
      <button type="button" className="btn btn-outline btn-small" onClick={onDismiss}>
        Dismiss export error
      </button>
    </div>
  );
}
