/**
 * djay-connect - Library to read djay Pro's MediaLibrary.db and emit track change events.
 *
 * @module djay-connect
 */

// Main connector class
export { DjayConnect } from './djayConnect.js';

// Detection utilities
export {
  getDefaultDjayInstallPath,
  getDefaultDatabasePath,
  getDefaultDatabasePaths,
  detectDjayInstallation,
} from './detect.js';

// TSAF parser (exported for tests and advanced use)
export {
  extractString,
  extractDouble,
  extractDate,
  parseHistorySessionItem,
  type DjayHistoryItemFields,
} from './tsaf.js';

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
