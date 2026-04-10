import { describe, expect, it, vi } from 'vitest';
import {
  detectDjayInstallation,
  getDefaultDatabasePath,
  getDefaultDatabasePaths,
  getDefaultDjayInstallPath,
} from '../src/detect';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from 'fs';
const mockExistsSync = vi.mocked(existsSync);

describe('detect', () => {
  describe('getDefaultDjayInstallPath', () => {
    it('points to the djay folder under Music', () => {
      const path = getDefaultDjayInstallPath();
      expect(path).toContain('Music');
      expect(path).toContain('djay');
    });
  });

  describe('getDefaultDatabasePaths', () => {
    it('returns platform-specific MediaLibrary.db candidates', () => {
      const paths = getDefaultDatabasePaths();
      if (process.platform === 'darwin') {
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain('djay Media Library.djayMediaLibrary');
        expect(paths[0]).toMatch(/MediaLibrary\.db$/);
      } else if (process.platform === 'win32') {
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain('djay Media Library');
        expect(paths[0]).toMatch(/MediaLibrary\.db$/);
      } else {
        expect(paths).toEqual([]);
      }
    });
  });

  describe('getDefaultDatabasePath', () => {
    it('returns the first candidate when it exists', () => {
      mockExistsSync.mockReturnValue(true);
      const path = getDefaultDatabasePath();
      expect(path).toMatch(/MediaLibrary\.db$/);
    });

    it('falls back to the first candidate when none exist', () => {
      mockExistsSync.mockReturnValue(false);
      const path = getDefaultDatabasePath();
      const [firstCandidate] = getDefaultDatabasePaths();
      if (firstCandidate) {
        expect(path).toBe(firstCandidate);
      } else {
        expect(path).toBe('');
      }
    });
  });

  describe('detectDjayInstallation', () => {
    it('returns found=true when the djay folder exists', () => {
      mockExistsSync.mockReturnValue(true);
      const result = detectDjayInstallation();
      expect(result.found).toBe(true);
      expect(result.path).toContain('djay');
    });

    it('returns found=false when the djay folder does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = detectDjayInstallation();
      expect(result.found).toBe(false);
    });
  });
});
