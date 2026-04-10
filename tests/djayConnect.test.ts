import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createDatabase from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DjayConnect } from '../src/djayConnect';
import {
  HISTORY_ITEM_FIXTURES,
  fixtureBuffer,
} from './fixtures/historySessionItems';

/**
 * Build a throwaway SQLite file with just enough of djay Pro's YapDatabase
 * schema for DjayConnect to read, then seed it with the provided fixtures.
 */
function buildTestDatabase(
  seedFixtures: typeof HISTORY_ITEM_FIXTURES,
): { dbPath: string; cleanup: () => void; insertFixture: (fx: typeof HISTORY_ITEM_FIXTURES[number]) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'djay-connect-test-'));
  const dbPath = join(dir, 'MediaLibrary.db');

  const db = new createDatabase(dbPath);
  db.exec(`
    CREATE TABLE database2 (
      rowid INTEGER PRIMARY KEY,
      collection TEXT NOT NULL,
      key TEXT NOT NULL,
      data BLOB,
      metadata BLOB
    );
  `);

  const insert = db.prepare(
    `INSERT INTO database2 (collection, key, data) VALUES (?, ?, ?)`,
  );
  for (const fx of seedFixtures) {
    insert.run('historySessionItems', fx.key, fixtureBuffer(fx));
  }

  const insertFixture = (fx: typeof HISTORY_ITEM_FIXTURES[number]): void => {
    insert.run('historySessionItems', fx.key, fixtureBuffer(fx));
  };

  const cleanup = (): void => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  return { dbPath, cleanup, insertFixture };
}

describe('DjayConnect', () => {
  let djay: DjayConnect | undefined;
  let testDb: ReturnType<typeof buildTestDatabase> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (djay) {
      djay.stop();
      djay = undefined;
    }
    if (testDb) {
      testDb.cleanup();
      testDb = undefined;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('uses default configuration', () => {
      djay = new DjayConnect();
      expect(djay.pollInterval).toBe(2000);
      expect(djay.running).toBe(false);
    });

    it('accepts custom poll interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 10_000 });
      expect(djay.pollInterval).toBe(10_000);
    });

    it('enforces minimum poll interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 500 });
      expect(djay.pollInterval).toBe(2000);
    });

    it('accepts a custom database path', () => {
      djay = new DjayConnect({ databasePath: '/tmp/custom/MediaLibrary.db' });
      expect(djay.path).toBe('/tmp/custom/MediaLibrary.db');
    });
  });

  describe('start', () => {
    it('emits ready with the database path', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const readyHandler = vi.fn();
      djay.on('ready', readyHandler);

      djay.start();

      expect(djay.running).toBe(true);
      expect(readyHandler).toHaveBeenCalledWith({ databasePath: testDb.dbPath });
    });

    it('emits the most recent history item as the initial track', () => {
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      const lastFixture = HISTORY_ITEM_FIXTURES[HISTORY_ITEM_FIXTURES.length - 1];
      expect(trackHandler).toHaveBeenCalledWith({
        track: expect.objectContaining({
          title: lastFixture.expected.title,
          artist: lastFixture.expected.artist,
          deckNumber: lastFixture.expected.deckNumber,
          duration: lastFixture.expected.durationSeconds,
          uuid: lastFixture.expected.uuid,
        }),
      });
    });

    it('emits an error if the database file is missing', () => {
      djay = new DjayConnect({ databasePath: '/nonexistent/MediaLibrary.db' });
      const errorHandler = vi.fn();
      djay.on('error', errorHandler);

      djay.start();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(djay.running).toBe(false);
    });

    it('does nothing if already running', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const readyHandler = vi.fn();
      djay.on('ready', readyHandler);

      djay.start();
      djay.start();

      expect(readyHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('polling', () => {
    it('emits a track event when a new history row appears', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();
      expect(trackHandler).toHaveBeenCalledTimes(1); // initial seed track

      // Simulate djay Pro adding a new track to the history.
      testDb.insertFixture(HISTORY_ITEM_FIXTURES[1]);
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(2);
      expect(trackHandler).toHaveBeenLastCalledWith({
        track: expect.objectContaining({
          title: HISTORY_ITEM_FIXTURES[1].expected.title,
          deckNumber: HISTORY_ITEM_FIXTURES[1].expected.deckNumber,
        }),
      });
    });

    it('does not re-emit previously seen tracks on subsequent polls', () => {
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const trackHandler = vi.fn();
      djay.on('track', trackHandler);

      djay.start();
      expect(trackHandler).toHaveBeenCalledTimes(1); // initial track only

      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(1);
    });

    it('emits a poll event on each cycle', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const pollHandler = vi.fn();
      djay.on('poll', pollHandler);

      djay.start();
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);

      expect(pollHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('stops polling and closes the database', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      djay.start();
      expect(djay.running).toBe(true);

      djay.stop();
      expect(djay.running).toBe(false);
    });

    it('can be called when not running', () => {
      djay = new DjayConnect();
      expect(() => djay!.stop()).not.toThrow();
    });
  });

  describe('setPollInterval', () => {
    it('enforces minimum interval', () => {
      djay = new DjayConnect({ pollIntervalMs: 5000 });
      djay.setPollInterval(500);
      expect(djay.pollInterval).toBe(2000);
    });

    it('restarts the timer when running', () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const pollHandler = vi.fn();
      djay.on('poll', pollHandler);

      djay.start();
      djay.setPollInterval(5000);

      // After 2s under the old interval we would have seen a poll; with 5s we should not.
      vi.advanceTimersByTime(2000);
      expect(pollHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);
      expect(pollHandler).toHaveBeenCalledTimes(1);
    });
  });
});
