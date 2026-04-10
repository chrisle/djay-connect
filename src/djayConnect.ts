/**
 * @fileoverview DjayConnect - SQLite-backed reader for djay Pro's MediaLibrary.db.
 *
 * djay Pro writes each played track into the `historySessionItems` collection
 * inside its YapDatabase-backed SQLite library (`MediaLibrary.db`). DjayConnect
 * polls that collection for new rows, parses each row's TSAF blob, and emits
 * `track` events as they arrive. The same schema is used on macOS and Windows.
 */

import EventEmitter from 'node:events';
import { existsSync } from 'node:fs';
import createDatabase, {
  type Database as BetterSqliteDatabase,
} from 'better-sqlite3-multiple-ciphers';
import { getDefaultDatabasePath } from './detect.js';
import {
  extractSourceURIs,
  parseHistorySessionItem,
  type DjayHistoryItemFields,
} from './tsaf.js';
import { type Logger, noopLogger } from './types/logger.js';
import type {
  DjayConnectOptions,
  DjayNowPlayingTrack,
  TypedEmitter,
} from './types.js';

interface LocationRow {
  collection: 'localMediaItemLocations' | 'globalMediaItemLocations';
  data: Buffer;
}

/**
 * Decode a djay file:// URI into an absolute OS path.
 * djay URL-encodes backslashes (`%5C`) and spaces (`%20`) on Windows.
 */
function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined;
  // Strip the scheme + the authority slashes; on Windows the authority is
  // empty and the path begins with a drive letter, e.g. "file:///D:%5C..."
  let path = uri.slice('file://'.length);
  if (path.startsWith('/') && /^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  // On Windows, normalize forward slashes that came from URL decoding into
  // backslashes so the path is usable by fs.readFile etc.
  if (process.platform === 'win32') {
    path = path.replace(/\//g, '\\');
  }
  return path;
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
      this.logger.error('Failed to open djay Pro database: %s', error.message);
      this.emit('error', error);
      return;
    }

    this.isRunning = true;
    this.logger.info(`Watching djay Pro library at ${this.databasePath}`);
    this.emit('ready', { databasePath: this.databasePath });

    // Seed cursor with the most-recent row and emit it as the initial "current" track.
    const initial = this.readLatestHistoryItem();
    if (initial) {
      this.lastRowId = initial.rowid;
      const track = this.toTrack(initial.fields);
      if (track) {
        this.logger.debug(
          `Initial track: ${track.artist} - ${track.title} [deck ${track.deckNumber}]`,
        );
        this.emit('track', { track });
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
        this.logger.warn('Error closing database: %s', String(err));
      }
      this.db = null;
    }
    this.lastRowId = 0;
    this.isRunning = false;
    this.logger.debug('Stopped');
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
    this.db.pragma('read_uncommitted = true');
  }

  private poll(): void {
    if (!this.db) return;
    try {
      this.emit('poll');

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
        if (!track) continue;
        this.logger.debug(
          `New track: ${track.artist} - ${track.title} [deck ${track.deckNumber}]`,
        );
        this.emit('track', { track });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('Poll error: %s', error.message);
      this.emit('error', error);
    }
  }

  private readLatestHistoryItem(): { rowid: number; fields: DjayHistoryItemFields } | null {
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
    if (!fields.title && !fields.artist) return null;
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

    // Enrich with location data (file path or streaming URIs) when we can
    // resolve the titleID against the *MediaItemLocations collections.
    if (fields.titleID) {
      const uris = this.readSourceURIs(fields.titleID);
      if (uris.length > 0) {
        track.sourceURIs = uris;
        for (const uri of uris) {
          if (uri.startsWith('file://')) {
            const decoded = fileUriToPath(uri);
            if (decoded) {
              track.filePath = decoded;
              break;
            }
          }
        }
      }
    }

    return track;
  }

  /**
   * Look up the raw `sourceURIs` for a titleID. Local files live in
   * `localMediaItemLocations`, streaming tracks in `globalMediaItemLocations`.
   * Returns every URI recorded for the track — can be empty, one, or many.
   */
  private readSourceURIs(titleID: string): string[] {
    if (!this.db) return [];
    try {
      const row = this.db
        .prepare<[string], LocationRow>(
          `SELECT collection, data
             FROM database2
            WHERE collection IN ('localMediaItemLocations','globalMediaItemLocations')
              AND key = ?`,
        )
        .get(titleID);
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
