/**
 * @fileoverview DjayConnect - SQLite-backed reader for djay Pro's MediaLibrary.db.
 *
 * djay Pro writes each played track into the `historySessionItems` collection
 * inside its YapDatabase-backed SQLite library (`MediaLibrary.db`). DjayConnect
 * polls that collection for new rows, parses each row's TSAF blob, and emits
 * `track` events as they arrive. The same schema is used on macOS and Windows.
 */

import EventEmitter from "node:events";
import { existsSync } from "node:fs";
import { win32 as win32Path } from "node:path";
import createDatabase, {
  type Database as BetterSqliteDatabase,
  type Statement,
} from "better-sqlite3-multiple-ciphers";
import { getDefaultDatabasePath } from "./detect.js";
import {
  extractSourceURIs,
  parseHistorySessionItem,
  parseMediaItemTitle,
  type DjayHistoryItemFields,
  type DjayMediaItemTitleFields,
} from "./tsaf.js";
import { type Logger, noopLogger } from "./types/logger.js";
import type {
  DjayConnectOptions,
  DjayNowPlayingTrack,
  TypedEmitter,
} from "./types.js";

interface LocationRow {
  collection: "localMediaItemLocations" | "globalMediaItemLocations";
  data: Buffer;
}

interface MediaItemTitleRow {
  data: Buffer;
}

/**
 * Decode a djay file:// URI into an absolute OS path.
 * djay URL-encodes backslashes (`%5C`) and spaces (`%20`) on Windows.
 */
function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  // Strip the scheme + the authority slashes; on Windows the authority is
  // empty and the path begins with a drive letter, e.g. "file:///D:%5C..."
  let path = uri.slice("file://".length);
  if (path.startsWith("/") && /^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  // On Windows, normalize forward slashes that came from URL decoding into
  // backslashes so the path is usable by fs.readFile etc.
  if (process.platform === "win32") {
    path = path.replace(/\//g, "\\");
  }
  return path;
}

/**
 * The name djay Pro shows for a file that carries no title tag: its file name
 * without the extension. Accepts both `/` and `\` separators so the decoded
 * path resolves the same way whichever platform wrote the library.
 */
function fileNameTitle(filePath: string): string {
  return win32Path.parse(filePath).name;
}

const MIN_POLL_INTERVAL = 2000;
const DEFAULT_POLL_INTERVAL = 2000;

interface HistoryRow {
  rowid: number;
  key: string;
  data: Buffer;
}

/**
 * DjayConnect monitors djay Pro's MediaLibrary.db for new history entries
 * and emits events when the currently playing track changes.
 */
export class DjayConnect extends (EventEmitter as new () => TypedEmitter) {
  private pollIntervalMs: number;
  private databasePath: string;
  private logger: Logger;
  private db: BetterSqliteDatabase | null = null;
  private locationStatement: Statement<[string], LocationRow> | null = null;
  private mediaItemTitleStatement: Statement<
    [string],
    MediaItemTitleRow
  > | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastRowId: number = 0;
  private isRunning: boolean = false;

  constructor(options: DjayConnectOptions = {}) {
    super();
    this.logger = options.logger ?? noopLogger;
    this.databasePath = options.databasePath ?? getDefaultDatabasePath();
    this.pollIntervalMs = Math.max(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL,
      MIN_POLL_INTERVAL,
    );
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    try {
      this.openDatabase();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Failed to open djay Pro database: %s", error.message);
      this.emit("error", error);
      return;
    }

    this.isRunning = true;
    this.logger.info(`Watching djay Pro library at ${this.databasePath}`);
    this.emit("ready", { databasePath: this.databasePath });

    // Pin the poll cursor to the highest existing rowid BEFORE anything else.
    // Using a dedicated MAX(rowid) query (rather than inferring it from the
    // parsed latest row) guarantees the cursor is seeded even when the most
    // recent row fails to parse — otherwise lastRowId would stay 0 and the very
    // first poll would replay the entire history backlog as if every old track
    // were playing right now.
    this.lastRowId = this.readMaxHistoryRowId();

    // Emit the most-recent row as the initial "current" track, flagged with
    // `isInitial` so consumers can tell it apart from live plays: it is whatever
    // was already in djay Pro's history when monitoring began, not a new play.
    const initial = this.readLatestHistoryItem();
    if (initial) {
      const track = this.toTrack(initial.fields);
      if (track) {
        this.logger.debug(
          `Initial track: ${track.artist} - ${track.title} [deck ${track.deckNumber}]`,
        );
        this.emit("track", { track, isInitial: true });
      }
    }

    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        this.logger.warn("Error closing database: %s", String(err));
      }
      this.db = null;
      this.locationStatement = null;
      this.mediaItemTitleStatement = null;
    }
    this.lastRowId = 0;
    this.isRunning = false;
    this.logger.debug("Stopped");
  }

  get running(): boolean {
    return this.isRunning;
  }

  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = Math.max(intervalMs, MIN_POLL_INTERVAL);
    if (this.isRunning && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    }
  }

  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  get path(): string {
    return this.databasePath;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private openDatabase(): void {
    if (!existsSync(this.databasePath)) {
      throw new Error(`djay Pro database not found at: ${this.databasePath}`);
    }

    // Open read-only so we can never corrupt djay Pro's live library.
    this.db = new createDatabase(this.databasePath, { readonly: true });

    // djay Pro keeps the database in WAL mode while running. Enabling
    // read_uncommitted lets us observe writes that haven't been checkpointed
    // yet, so new history rows appear in near real time.
    this.db.pragma("read_uncommitted = true");

    // Prepared once per open: both run for every history row we enrich.
    this.locationStatement = this.db.prepare<[string], LocationRow>(
      `SELECT collection, data
         FROM database2
        WHERE collection IN ('localMediaItemLocations','globalMediaItemLocations')
          AND key = ?`,
    );
    this.mediaItemTitleStatement = this.db.prepare<[string], MediaItemTitleRow>(
      `SELECT data
         FROM database2
        WHERE collection = 'mediaItemTitleIDs'
          AND key = ?`,
    );
  }

  private poll(): void {
    if (!this.db) return;
    try {
      this.emit("poll");

      const rows = this.db
        .prepare<[number], HistoryRow>(
          `SELECT rowid, key, data
             FROM database2
            WHERE collection = 'historySessionItems'
              AND rowid > ?
            ORDER BY rowid ASC`,
        )
        .all(this.lastRowId);

      for (const row of rows) {
        this.lastRowId = Math.max(this.lastRowId, row.rowid);
        const fields = parseHistorySessionItem(row.data);
        if (!fields) {
          this.logger.warn(
            `Could not parse historySessionItem ${row.key} (${row.data.length} bytes)`,
          );
          continue;
        }
        const track = this.toTrack(fields);
        if (!track) {
          this.logger.warn(
            `historySessionItem ${row.key} names no title, and titleID ${fields.titleID} resolves to none either`,
          );
          continue;
        }
        this.logger.debug(
          `New track: ${track.artist} - ${track.title} [deck ${track.deckNumber}]`,
        );
        this.emit("track", { track });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("Poll error: %s", error.message);
      this.emit("error", error);
    }
  }

  /**
   * Return the highest rowid currently present in `historySessionItems`, or 0
   * when the collection is empty. Used to pin the poll cursor at start() so
   * pre-existing history is never replayed as live playback — even when the
   * latest row's blob fails to parse.
   */
  private readMaxHistoryRowId(): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare<[], { maxRowId: number | null }>(
        `SELECT MAX(rowid) AS maxRowId
           FROM database2
          WHERE collection = 'historySessionItems'`,
      )
      .get();
    return row?.maxRowId ?? 0;
  }

  private readLatestHistoryItem(): {
    rowid: number;
    fields: DjayHistoryItemFields;
  } | null {
    if (!this.db) return null;
    const row = this.db
      .prepare<[], HistoryRow>(
        `SELECT rowid, key, data
           FROM database2
          WHERE collection = 'historySessionItems'
          ORDER BY rowid DESC
          LIMIT 1`,
      )
      .get();
    if (!row) return null;
    const fields = parseHistorySessionItem(row.data);
    if (!fields) return null;
    return { rowid: row.rowid, fields };
  }

  private toTrack(fields: DjayHistoryItemFields): DjayNowPlayingTrack | null {
    const track: DjayNowPlayingTrack = {
      title: fields.title,
      artist: fields.artist,
      duration: fields.duration,
      deckNumber: fields.deckNumber,
      startTime: fields.startTime,
      uuid: fields.uuid,
      sessionUUID: fields.sessionUUID,
      titleID: fields.titleID,
      originSourceID: fields.originSourceID,
      isrc: fields.isrc,
    };

    if (fields.titleID) {
      // A history row with no strings at all still points at its media item,
      // and that record carries the title djay displays for the file. djay Pro
      // on macOS writes such rows for untagged files added via My Files.
      if (!track.title && !track.artist) {
        const named = this.readMediaItemTitle(fields.titleID);
        if (named) {
          track.title = named.title;
          track.artist = named.artist;
          this.logger.debug(
            `Resolved historySessionItem ${fields.uuid} via mediaItemTitleIDs ${fields.titleID}`,
          );
        }
      }

      // Enrich with location data (file path or streaming URIs) when we can
      // resolve the titleID against the *MediaItemLocations collections.
      const uris = this.readSourceURIs(fields.titleID);
      if (uris.length > 0) {
        track.sourceURIs = uris;
        for (const uri of uris) {
          if (uri.startsWith("file://")) {
            const decoded = fileUriToPath(uri);
            if (decoded) {
              track.filePath = decoded;
              break;
            }
          }
        }
      }

      // Last resort, and what djay itself shows for a file with no title tag.
      if (!track.title && track.filePath) {
        track.title = fileNameTitle(track.filePath);
        this.logger.debug(
          `Resolved historySessionItem ${fields.uuid} from its file name: ${track.title}`,
        );
      }
    }

    if (!track.title && !track.artist) return null;
    return track;
  }

  /**
   * Look up the `mediaItemTitleIDs` record for a titleID and return the title
   * strings it carries, or null when djay has no such record.
   */
  private readMediaItemTitle(titleID: string): DjayMediaItemTitleFields | null {
    if (!this.mediaItemTitleStatement) return null;
    try {
      const row = this.mediaItemTitleStatement.get(titleID);
      if (!row) return null;
      const named = parseMediaItemTitle(row.data);
      return named.title || named.artist ? named : null;
    } catch (err) {
      this.logger.warn(
        `Failed to resolve mediaItemTitleIDs ${titleID}: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Look up the raw `sourceURIs` for a titleID. Local files live in
   * `localMediaItemLocations`, streaming tracks in `globalMediaItemLocations`.
   * Returns every URI recorded for the track — can be empty, one, or many.
   */
  private readSourceURIs(titleID: string): string[] {
    if (!this.locationStatement) return [];
    try {
      const row = this.locationStatement.get(titleID);
      if (!row) return [];
      return extractSourceURIs(row.data);
    } catch (err) {
      this.logger.warn(
        `Failed to resolve location for titleID ${titleID}: ${String(err)}`,
      );
      return [];
    }
  }
}
