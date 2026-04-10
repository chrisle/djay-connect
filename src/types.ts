import EventEmitter from 'node:events';
import type { StrictEventEmitter } from 'strict-event-emitter-types';
import type { Logger } from './types/logger.js';

/**
 * Configuration options for DjayConnect.
 */
export type DjayConnectOptions = {
  /** Polling interval in milliseconds (minimum 2000). Default: 2000 */
  pollIntervalMs?: number;
  /** Custom path to djay Pro's MediaLibrary.db. If omitted, uses the default per-platform path. */
  databasePath?: string;
  /** Logger instance. If omitted, logging is disabled. */
  logger?: Logger;
};

/**
 * A parsed track from djay Pro's history session.
 */
export interface DjayNowPlayingTrack {
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Duration in seconds */
  duration: number;
  /** Deck number the track is loaded on (1-4) */
  deckNumber: number;
  /** When the track was started in djay Pro */
  startTime: Date;
  /** UUID of this history entry */
  uuid: string;
  /** UUID of the containing history session */
  sessionUUID: string;
}

/**
 * Info emitted when DjayConnect is ready.
 */
export type DjayReadyInfo = {
  /** Path to the MediaLibrary.db file being monitored */
  databasePath: string;
};

/**
 * Payload for track events.
 */
export type DjayTrackPayload = {
  /** The track that was detected */
  track: DjayNowPlayingTrack;
};

/**
 * Events emitted by DjayConnect.
 */
export interface DjayConnectEvents {
  /** Emitted when the connector is ready and monitoring has started */
  ready: (info: DjayReadyInfo) => void;
  /** Emitted on each poll cycle */
  poll: () => void;
  /** Emitted when a new track is detected */
  track: (payload: DjayTrackPayload) => void;
  /** Emitted on errors */
  error: (err: Error) => void;
}

export type TypedEmitter = StrictEventEmitter<EventEmitter, DjayConnectEvents>;
