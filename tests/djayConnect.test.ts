import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import createDatabase from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DjayConnect } from "../src/djayConnect";
import {
  HISTORY_ITEM_FIXTURES,
  fixtureBuffer,
  untaggedHistoryItem,
  withoutField,
} from "./fixtures/historySessionItems";
import {
  LOCATION_FIXTURES,
  locationBuffer,
} from "./fixtures/mediaItemLocations";
import {
  MEDIA_ITEM_TITLE_FIXTURES,
  mediaItemTitleBuffer,
} from "./fixtures/mediaItemTitleIDs";

/**
 * Build a throwaway SQLite file with just enough of djay Pro's YapDatabase
 * schema for DjayConnect to read, then seed it with the provided fixtures.
 * Optionally seeds `localMediaItemLocations` / `globalMediaItemLocations`
 * rows from LOCATION_FIXTURES so integration tests can exercise the
 * titleID → filePath / sourceURIs join, and `mediaItemTitleIDs` rows from
 * MEDIA_ITEM_TITLE_FIXTURES for the titleID → title / artist join.
 */
function buildTestDatabase(
  seedFixtures: typeof HISTORY_ITEM_FIXTURES,
  options: { seedLocations?: boolean; seedMediaItemTitles?: boolean } = {},
): {
  dbPath: string;
  cleanup: () => void;
  insertFixture: (fx: (typeof HISTORY_ITEM_FIXTURES)[number]) => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "djay-connect-test-"));
  const dbPath = join(dir, "MediaLibrary.db");

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
    insert.run("historySessionItems", fx.key, fixtureBuffer(fx));
  }

  if (options.seedLocations) {
    for (const loc of LOCATION_FIXTURES) {
      insert.run(loc.collection, loc.key, locationBuffer(loc));
    }
  }

  if (options.seedMediaItemTitles) {
    for (const item of MEDIA_ITEM_TITLE_FIXTURES) {
      insert.run("mediaItemTitleIDs", item.key, mediaItemTitleBuffer(item));
    }
  }

  const insertFixture = (fx: (typeof HISTORY_ITEM_FIXTURES)[number]): void => {
    insert.run("historySessionItems", fx.key, fixtureBuffer(fx));
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

/**
 * These tests open a real SQLite file, so they need a `better-sqlite3-multiple-
 * ciphers` addon built for the Node ABI. A checkout that has been through the
 * desktop app's `npm run rebuild` carries an Electron-ABI build of the very same
 * file — the desktop resolves this package's own `node_modules` copy at runtime,
 * so it has to stay that way — and every test below then dies on the same
 * NODE_MODULE_VERSION error.
 *
 * Skip them in that one situation rather than reporting a dozen failures that
 * say nothing about the code. Any other load error is a real one and is left to
 * fail. CI installs with plain `npm ci` and always runs them.
 */
function abiMismatch(): string | null {
  try {
    new createDatabase(":memory:").close();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("NODE_MODULE_VERSION")
      ? message.split("\n").join(" ")
      : null;
  }
}

const NATIVE_ABI_MISMATCH = abiMismatch();

if (NATIVE_ABI_MISMATCH) {
  console.warn(
    `[djayConnect.test] skipping database-backed tests: ${NATIVE_ABI_MISMATCH}\n` +
      `[djayConnect.test] this working copy is built for Electron. ` +
      `Run "npm rebuild better-sqlite3-multiple-ciphers" here to test against Node, ` +
      `then "npm run rebuild" in apps/desktop before launching the desktop app again.`,
  );
}

describe.skipIf(NATIVE_ABI_MISMATCH !== null)("DjayConnect", () => {
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

  describe("constructor", () => {
    it("uses default configuration", () => {
      djay = new DjayConnect();
      expect(djay.pollInterval).toBe(2000);
      expect(djay.running).toBe(false);
    });

    it("accepts custom poll interval", () => {
      djay = new DjayConnect({ pollIntervalMs: 10_000 });
      expect(djay.pollInterval).toBe(10_000);
    });

    it("enforces minimum poll interval", () => {
      djay = new DjayConnect({ pollIntervalMs: 500 });
      expect(djay.pollInterval).toBe(2000);
    });

    it("accepts a custom database path", () => {
      djay = new DjayConnect({ databasePath: "/tmp/custom/MediaLibrary.db" });
      expect(djay.path).toBe("/tmp/custom/MediaLibrary.db");
    });
  });

  describe("start", () => {
    it("emits ready with the database path", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const readyHandler = vi.fn();
      djay.on("ready", readyHandler);

      djay.start();

      expect(djay.running).toBe(true);
      expect(readyHandler).toHaveBeenCalledWith({
        databasePath: testDb.dbPath,
      });
    });

    it("emits the most recent history item as the initial track", () => {
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      const lastFixture =
        HISTORY_ITEM_FIXTURES[HISTORY_ITEM_FIXTURES.length - 1];
      expect(trackHandler).toHaveBeenCalledWith({
        track: expect.objectContaining({
          title: lastFixture.expected.title,
          artist: lastFixture.expected.artist,
          deckNumber: lastFixture.expected.deckNumber,
          duration: lastFixture.expected.durationSeconds,
          uuid: lastFixture.expected.uuid,
        }),
        isInitial: true,
      });
    });

    it("flags the seed track with isInitial so consumers can skip it", () => {
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      expect(trackHandler.mock.calls[0][0].isInitial).toBe(true);
    });

    it("pins the poll cursor to MAX(rowid) even when the latest row is unparseable", () => {
      // Without a MAX(rowid) cursor seed, a final unparseable row would leave
      // lastRowId at 0 and the first poll would replay the entire backlog.
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      const raw = new createDatabase(testDb.dbPath);
      raw
        .prepare(
          `INSERT INTO database2 (collection, key, data) VALUES (?, ?, ?)`,
        )
        .run(
          "historySessionItems",
          "junk-key",
          Buffer.from([0x00, 0x01, 0x02]),
        );
      raw.close();

      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();
      // Latest row is unparseable, so there is no seed track to emit.
      expect(trackHandler).not.toHaveBeenCalled();

      // The cursor was still pinned to the junk row's rowid, so the first poll
      // replays nothing from the existing history.
      vi.advanceTimersByTime(2000);
      expect(trackHandler).not.toHaveBeenCalled();
    });

    it("emits an error if the database file is missing", () => {
      djay = new DjayConnect({ databasePath: "/nonexistent/MediaLibrary.db" });
      const errorHandler = vi.fn();
      djay.on("error", errorHandler);

      djay.start();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(djay.running).toBe(false);
    });

    it("does nothing if already running", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const readyHandler = vi.fn();
      djay.on("ready", readyHandler);

      djay.start();
      djay.start();

      expect(readyHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("polling", () => {
    it("emits a track event when a new history row appears", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

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

    it("does not re-emit previously seen tracks on subsequent polls", () => {
      testDb = buildTestDatabase(HISTORY_ITEM_FIXTURES);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();
      expect(trackHandler).toHaveBeenCalledTimes(1); // initial track only

      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(1);
    });

    it("emits a poll event on each cycle", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const pollHandler = vi.fn();
      djay.on("poll", pollHandler);

      djay.start();
      vi.advanceTimersByTime(2000);
      vi.advanceTimersByTime(2000);

      expect(pollHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe("stop", () => {
    it("stops polling and closes the database", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      djay.start();
      expect(djay.running).toBe(true);

      djay.stop();
      expect(djay.running).toBe(false);
    });

    it("can be called when not running", () => {
      djay = new DjayConnect();
      expect(() => djay!.stop()).not.toThrow();
    });
  });

  describe("location enrichment", () => {
    it("resolves filePath for a local track", () => {
      const localHistory = HISTORY_ITEM_FIXTURES.find(
        (f) => f.expected.originSourceID === "explorer",
      )!;
      testDb = buildTestDatabase([localHistory], { seedLocations: true });
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      const track = trackHandler.mock.calls[0][0].track;
      expect(track.titleID).toBe("307b767ff2463cce064180664e6b4c89");
      expect(track.sourceURIs).toHaveLength(1);
      expect(track.sourceURIs?.[0]).toMatch(/^file:\/\//);
      expect(track.filePath).toContain("Voodoo_People_(Pendulum_Mix).mp3");
    });

    it("exposes multiple sourceURIs for a multi-service streaming track", () => {
      const goodCatch = HISTORY_ITEM_FIXTURES.find(
        (f) => f.expected.title === "Good Catch (Black Caviar Remix)",
      )!;
      testDb = buildTestDatabase([goodCatch], { seedLocations: true });
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      const track = trackHandler.mock.calls[0][0].track;
      expect(track.sourceURIs).toEqual([
        "soundcloud:tracks:1150488265",
        "beatport:track:15949981",
      ]);
      expect(track.filePath).toBeUndefined();
    });

    it("emits the track unchanged when no location row is present", () => {
      const anyHistory = HISTORY_ITEM_FIXTURES[0];
      testDb = buildTestDatabase([anyHistory]); // no seedLocations
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      const track = trackHandler.mock.calls[0][0].track;
      expect(track.sourceURIs).toBeUndefined();
      expect(track.filePath).toBeUndefined();
      expect(track.title).toBe(anyHistory.expected.title);
    });
  });

  describe("history rows without title strings (NP3-407)", () => {
    // djay Pro on macOS writes a history row with no title/artist for an
    // untagged file added via My Files; the strings live in mediaItemTitleIDs.
    const voodoo = HISTORY_ITEM_FIXTURES[0];
    const untaggedFile = MEDIA_ITEM_TITLE_FIXTURES[0]; // "satisfaction", no artist
    const taggedFile = MEDIA_ITEM_TITLE_FIXTURES[1]; // Cotton Eye Joe / Rednex
    const voodooLocation = LOCATION_FIXTURES[0]; // file:// row for Voodoo People

    it("fills the title from mediaItemTitleIDs when the media item has no artist", () => {
      const row = untaggedHistoryItem(voodoo, untaggedFile.key);
      testDb = buildTestDatabase([row], { seedMediaItemTitles: true });
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      expect(trackHandler.mock.calls[0][0].track).toEqual(
        expect.objectContaining({
          title: "satisfaction",
          artist: "",
          titleID: untaggedFile.key,
          deckNumber: 1,
          uuid: voodoo.expected.uuid,
        }),
      );
    });

    it("fills title and artist from mediaItemTitleIDs when the media item has both", () => {
      const row = untaggedHistoryItem(voodoo, taggedFile.key);
      testDb = buildTestDatabase([row], { seedMediaItemTitles: true });
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      expect(trackHandler.mock.calls[0][0].track).toEqual(
        expect.objectContaining({
          title: "Cotton Eye Joe (TRIODE Remix)",
          artist: "Rednex",
          titleID: taggedFile.key,
        }),
      );
    });

    it("falls back to the file name when there is no mediaItemTitleIDs row", () => {
      const row = untaggedHistoryItem(voodoo, voodooLocation.key);
      testDb = buildTestDatabase([row], { seedLocations: true });
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      const track = trackHandler.mock.calls[0][0].track;
      expect(track.title).toBe("14187302_Voodoo_People_(Pendulum_Mix)");
      expect(track.artist).toBe("");
      expect(track.filePath).toContain("Voodoo_People_(Pendulum_Mix).mp3");
      expect(track.sourceURIs).toEqual(voodooLocation.expected.sourceURIs);
    });

    it("rescues a live play, logging at debug rather than warning", () => {
      testDb = buildTestDatabase([voodoo], { seedMediaItemTitles: true });
      const logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
        logger,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();
      expect(trackHandler).toHaveBeenCalledTimes(1); // initial seed track

      testDb.insertFixture(untaggedHistoryItem(voodoo, untaggedFile.key));
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(2);
      expect(trackHandler).toHaveBeenLastCalledWith({
        track: expect.objectContaining({ title: "satisfaction", artist: "" }),
      });
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("via mediaItemTitleIDs"),
      );
    });

    it("drops the row when nothing resolves, without the 'Could not parse' warning", () => {
      // titleID points nowhere: no mediaItemTitleIDs row, no location row.
      const row = untaggedHistoryItem(
        voodoo,
        "ffffffffffffffffffffffffffffffff",
      );
      testDb = buildTestDatabase([voodoo]);
      const logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
        logger,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();
      testDb.insertFixture(row);
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(1); // seed track only
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain("resolves to none");
      expect(logger.warn.mock.calls[0][0]).not.toContain("Could not parse");
    });

    it("still warns 'Could not parse' for a row with no titleID either", () => {
      testDb = buildTestDatabase([voodoo]);
      const logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
        logger,
      });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();
      const raw = new createDatabase(testDb.dbPath);
      raw
        .prepare(
          `INSERT INTO database2 (collection, key, data) VALUES (?, ?, ?)`,
        )
        .run("historySessionItems", "junk-key", Buffer.from("TSAFnothing"));
      raw.close();
      vi.advanceTimersByTime(2000);

      expect(trackHandler).toHaveBeenCalledTimes(1); // seed track only
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain(
        "Could not parse historySessionItem junk-key",
      );
    });

    it("keeps a row that has a title but no artist, with no lookup (NP3-381)", () => {
      const titleOnly = {
        ...voodoo,
        hex: withoutField(fixtureBuffer(voodoo), "artist").toString("hex"),
      };
      // No mediaItemTitleIDs or location rows: the history row is enough.
      testDb = buildTestDatabase([titleOnly]);
      djay = new DjayConnect({ databasePath: testDb.dbPath });
      const trackHandler = vi.fn();
      djay.on("track", trackHandler);

      djay.start();

      expect(trackHandler).toHaveBeenCalledTimes(1);
      expect(trackHandler.mock.calls[0][0].track).toEqual(
        expect.objectContaining({
          title: "Voodoo People (Pendulum Mix)",
          artist: "",
        }),
      );
    });
  });

  describe("setPollInterval", () => {
    it("enforces minimum interval", () => {
      djay = new DjayConnect({ pollIntervalMs: 5000 });
      djay.setPollInterval(500);
      expect(djay.pollInterval).toBe(2000);
    });

    it("restarts the timer when running", () => {
      testDb = buildTestDatabase([HISTORY_ITEM_FIXTURES[0]]);
      djay = new DjayConnect({
        databasePath: testDb.dbPath,
        pollIntervalMs: 2000,
      });
      const pollHandler = vi.fn();
      djay.on("poll", pollHandler);

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
