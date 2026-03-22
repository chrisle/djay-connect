import { describe, expect, it, vi } from 'vitest';
import { getDefaultNowPlayingPath, getDefaultDjayInstallPath, detectDjayInstallation } from '../src/detect';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from 'fs';
const mockExistsSync = vi.mocked(existsSync);

describe('detect', () => {
  describe('getDefaultNowPlayingPath', () => {
    it('returns a path ending with NowPlaying.txt', () => {
      const path = getDefaultNowPlayingPath();
      expect(path).toContain('NowPlaying.txt');
      expect(path).toContain('djay Media Library.djayMediaLibrary');
    });
  });

  describe('getDefaultDjayInstallPath', () => {
    it('returns a path containing djay', () => {
      const path = getDefaultDjayInstallPath();
      expect(path).toContain('djay');
    });
  });

  describe('detectDjayInstallation', () => {
    it('returns found=true when djay folder exists', () => {
      mockExistsSync.mockReturnValue(true);
      const result = detectDjayInstallation();
      expect(result.found).toBe(true);
      expect(result.path).toContain('djay');
    });

    it('returns found=false when djay folder does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = detectDjayInstallation();
      expect(result.found).toBe(false);
    });
  });
});
