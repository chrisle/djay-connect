import EventEmitter from 'node:events';
import type { StrictEventEmitter } from 'strict-event-emitter-types';
import type { Logger } from './types/logger.js';

/**
 * Configuration options for DjayConnect
 */
export type DjayConnectOptions = {
  /** Polling interval in milliseconds (minimum 5000). Default: 5000 */
  pollIntervalMs?: number;
  /** Custom path to NowPlaying.txt. If omitted, uses default djay Pro path. */
  nowPlayingPath?: string;
  /** Logger instance. If omitted, logging is disabled. */
  logger?: Logger;
};

/**
 * A parsed track from djay Pro's NowPlaying.txt file
 */
export interface DjayNowPlayingTrack {
  title: string;
  artist: string;
  album: string;
  time: string;
}

/**
 * Info emitted when DjayConnect is ready
 */
export type DjayReadyInfo = {
  /** Path to the NowPlaying.txt file being monitored */
  nowPlayingPath: string;
};

/**
 * Payload for track events
 */
export type DjayTrackPayload = {
  /** The track that was detected */
  track: DjayNowPlayingTrack;
};

/**
 * Events emitted by DjayConnect
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
