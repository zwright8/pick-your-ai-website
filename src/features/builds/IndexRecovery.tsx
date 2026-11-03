import { useEffect, useRef, useState } from 'react';

export function IndexRecovery({
  rebuild,
  onComplete,
}: {
  rebuild: () => Promise<number>;
  onComplete: (count: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const count = await rebuild();
      setConfirming(false);
      onComplete(count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rebuild the saved-build index.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!confirming ? (
        <button
          ref={openRef}
          type="button"
          className="btn btn-outline btn-small"
          onClick={() => setConfirming(true)}
        >
          Find saved builds in this browser
        </button>
      ) : (
        <div role="group" aria-label="Confirm saved-build index recovery">
          <p>
            This finds stored build records and adds missing entries to the library. An existing
            index is backed up before changes, and the build records are not changed. Close other
            tabs using this app first.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? 'Finding builds…' : 'Find builds'}
          </button>{' '}
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-outline btn-small"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setError(null);
              requestAnimationFrame(() => openRef.current?.focus());
            }}
          >
            Cancel
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
