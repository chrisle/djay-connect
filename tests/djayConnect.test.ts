import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DjayConnect } from '../src/djayConnect';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

const SAMPLE_NOWPLAYING = `Title: Echoes
Artist: Pink Floyd
Album: Meddle
Time: 23:31`;

describe('DjayConnect', () => {
  let djay: DjayConnect;

  beforeEach(() => {
    vi.useFakeTimers();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
  });

  afterEach(() => {
    if (djay) {
      djay.stop();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('uses default configuration', () => {
      djay = new DjayConnect();
      expect(djay.pollInterval).toBe(5000);
      expect(djay.running).toBe(false);
    });

    it('accepts custom poll interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 10000 });
      expect(djay.pollInterval).toBe(10000);
    });

    it('enforces minimum poll interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 1000 });
      expect(djay.pollInterval).toBe(5000);
    });

    it('accepts custom NowPlaying path', () => {
      djay = new DjayConnect({ nowPlayingPath: '/custom/path/NowPlaying.txt' });
      expect(djay.path).toBe('/custom/path/NowPlaying.txt');
    });
  });

  describe('start', () => {
    it('emits ready event', () => {
      djay = new DjayConnect();
      const readyHandler = vi.fn();
      djay.on('ready', readyHandler);

      djay.start();

      expect(djay.running).toBe(true);
      expect(readyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ nowPlayingPath: expect.any(String) })
      );
    });

    it('does nothing if already running', () => {
      djay = new DjayConnect();
      const readyHandler = vi.fn();
      djay.on('ready', readyHandler);

      djay.start();
      djay.start();

      expect(readyHandler).toHaveBeenCalledTimes(1);
    });

    it('emits initial track if NowPlaying.txt exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(SAMPLE_NOWPLAYING);

      djay = new DjayConnect();
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledWith({
        track: {
          title: 'Echoes',
          artist: 'Pink Floyd',
          album: 'Meddle',
          time: '23:31',
        },
      });
    });

    it('does not emit track if file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      djay = new DjayConnect();
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();

      expect(trackHandler).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('stops polling and resets state', () => {
      djay = new DjayConnect();
      djay.start();

      expect(djay.running).toBe(true);

      djay.stop();

      expect(djay.running).toBe(false);
    });

    it('can be called when not running', () => {
      djay = new DjayConnect();
      expect(() => djay.stop()).not.toThrow();
    });
  });

  describe('polling', () => {
    it('emits poll event on each cycle', () => {
      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const pollHandler = vi.fn();
      djay.on('poll', pollHandler);

      djay.start();
      vi.advanceTimersByTime(5000);

      expect(pollHandler).toHaveBeenCalledTimes(1);
    });

    it('emits track event when track changes', () => {
      mockExistsSync.mockReturnValue(false);

      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();

      // Simulate NowPlaying.txt appearing
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(SAMPLE_NOWPLAYING);

      vi.advanceTimersByTime(5000);

      expect(trackHandler).toHaveBeenCalledWith({
        track: {
          title: 'Echoes',
          artist: 'Pink Floyd',
          album: 'Meddle',
          time: '23:31',
        },
      });
    });

    it('does not emit duplicate tracks', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(SAMPLE_NOWPLAYING);

      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();
      // Initial track emitted
      expect(trackHandler).toHaveBeenCalledTimes(1);

      // Same track on next poll
      vi.advanceTimersByTime(5000);
      expect(trackHandler).toHaveBeenCalledTimes(1);
    });

    it('emits new track when content changes', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(SAMPLE_NOWPLAYING);

      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();
      expect(trackHandler).toHaveBeenCalledTimes(1);

      // Change to a new track
      mockReadFileSync.mockReturnValue(`Title: Money
Artist: Pink Floyd
Album: The Dark Side of the Moon
Time: 6:22`);

      vi.advanceTimersByTime(5000);
      expect(trackHandler).toHaveBeenCalledTimes(2);
      expect(trackHandler).toHaveBeenLastCalledWith({
        track: {
          title: 'Money',
          artist: 'Pink Floyd',
          album: 'The Dark Side of the Moon',
          time: '6:22',
        },
      });
    });

    it('emits error on parse failure', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const errorHandler = vi.fn();
      djay.on('error', errorHandler);

      djay.start();
      // Initial parse failure is caught internally (returns null), not emitted as error

      // Force an error during poll by making existsSync throw
      mockExistsSync.mockImplementation(() => {
        throw new Error('FS error');
      });

      vi.advanceTimersByTime(5000);
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('setPollInterval', () => {
    it('updates poll interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 5000 });
      djay.setPollInterval(10000);
      expect(djay.pollInterval).toBe(10000);
    });

    it('enforces minimum interval', () => {
      djay = new DjayConnect();
      djay.setPollInterval(1000);
      expect(djay.pollInterval).toBe(5000);
    });

    it('restarts timer if running', () => {
      djay = new DjayConnect({ pollIntervalMs: 5000 });
      const pollHandler = vi.fn();
      djay.on('poll', pollHandler);

      djay.start();

      // Change to 10s interval
      djay.setPollInterval(10000);

      // Advance by 5s - should NOT have polled yet (new interval is 10s)
      vi.advanceTimersByTime(5000);
      expect(pollHandler).not.toHaveBeenCalled();

      // Advance another 5s (total 10s) - NOW it should poll
      vi.advanceTimersByTime(5000);
      expect(pollHandler).toHaveBeenCalledTimes(1);
    });
  });
});
