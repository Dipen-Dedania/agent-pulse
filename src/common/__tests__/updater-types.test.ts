import { describe, it, expect } from 'vitest';
import { hasPendingUpdate, type UpdaterStatus } from '../updater-types';

describe('hasPendingUpdate', () => {
  it('is true only for available / downloaded', () => {
    const all: UpdaterStatus[] = [
      'idle', 'disabled', 'checking', 'available',
      'not-available', 'downloading', 'downloaded', 'error',
    ];
    const pending = all.filter(hasPendingUpdate);
    expect(pending).toEqual(['available', 'downloaded']);
  });
});
