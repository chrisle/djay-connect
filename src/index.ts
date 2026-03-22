/**
 * djay-connect - Library to read djay Pro's NowPlaying.txt file and emit track change events.
 *
 * @module djay-connect
 */

// Main connector class
export { DjayConnect } from './djayConnect.js';

// Detection utilities
export {
  getDefaultNowPlayingPath,
  getDefaultDjayInstallPath,
  detectDjayInstallation,
} from './detect.js';

// Logger
export type { Logger } from './types/logger.js';
export { noopLogger } from './types/logger.js';

// Core types
export type {
  DjayConnectOptions,
  DjayConnectEvents,
  DjayNowPlayingTrack,
  DjayReadyInfo,
  DjayTrackPayload,
} from './types.js';
