import { useSyncExternalStore } from 'react';
import { getValidatorStatus, validatorsReady } from '../contracts';

/*
 * Contract validators load as a lazy chunk. Components that validate synchronously while rendering
 * (export availability, shared-link decoding) call this hook so they re-render once validation is
 * possible, instead of showing a stale "still loading" result.
 */
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
void validatorsReady.then(notify, notify);

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useValidatorsStatus() {
  return useSyncExternalStore(subscribe, getValidatorStatus, getValidatorStatus);
}

export function useValidatorsReady(): boolean {
  return useValidatorsStatus() === 'ready';
}
