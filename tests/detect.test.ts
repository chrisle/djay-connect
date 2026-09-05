import { afterEach, describe, expect, it, vi } from 'vitest';
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

const realPlatform = process.platform;

/**
 * djay Pro ships on macOS and Windows only, and the candidate list is empty
 * anywhere else. Pinning the platform lets both supported layouts be asserted
 * from any runner: CI is Linux, where the unpinned suite exercised nothing but
 * the empty-candidate branch and failed on the one assertion that assumed a
 * candidate existed.
 */
function pinPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  pinPlatform(realPlatform);
});

describe('detect', () => {
  describe('getDefaultDjayInstallPath', () => {
    it('points to the djay folder under Music', () => {
      const path = getDefaultDjayInstallPath();
      expect(path).toContain('Music');
      expect(path).toContain('djay');
    });
  });

  describe('getDefaultDatabasePaths', () => {
    it('points at the .djayMediaLibrary bundle on macOS', () => {
      pinPlatform('darwin');
      const paths = getDefaultDatabasePaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('djay Media Library.djayMediaLibrary');
      expect(paths[0]).toMatch(/MediaLibrary\.db$/);
    });

    it('points at the plain library folder on Windows', () => {
      pinPlatform('win32');
      const paths = getDefaultDatabasePaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('djay Media Library');
      expect(paths[0]).not.toContain('.djayMediaLibrary');
      expect(paths[0]).toMatch(/MediaLibrary\.db$/);
    });

    it('has no candidates on a platform djay Pro does not ship on', () => {
      pinPlatform('linux');
      expect(getDefaultDatabasePaths()).toEqual([]);
    });
  });

  describe('getDefaultDatabasePath', () => {
    it.each(['darwin', 'win32'] as const)(
      'returns the first candidate when it exists on %s',
      (platform) => {
        pinPlatform(platform);
        mockExistsSync.mockReturnValue(true);
        expect(getDefaultDatabasePath()).toMatch(/MediaLibrary\.db$/);
      },
    );

    it.each(['darwin', 'win32'] as const)(
      'falls back to the first candidate when none exist on %s',
      (platform) => {
        pinPlatform(platform);
        mockExistsSync.mockReturnValue(false);
        expect(getDefaultDatabasePath()).toBe(getDefaultDatabasePaths()[0]);
      },
    );

    it('returns an empty string where there is no candidate to fall back to', () => {
      pinPlatform('linux');
      mockExistsSync.mockReturnValue(false);
      expect(getDefaultDatabasePath()).toBe('');
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
