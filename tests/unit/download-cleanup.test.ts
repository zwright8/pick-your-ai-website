import { afterEach, describe, expect, it, vi } from 'vitest';
import { download } from '../../src/features/builder/BuildToolbar';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('download cleanup', () => {
  it('removes the temporary link and revokes its URL when clicking fails', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => download('build.json', '{}')).toThrow('blocked');
    expect(document.querySelector('a[download="build.json"]')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
