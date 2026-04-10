/**
 * @fileoverview Known `originSourceID` values and URI schemes used by djay Pro.
 *
 * djay Pro for Windows 5.6.4 integrates with six streaming services and two
 * "local" source categories. Not all of these were observable in the session
 * used to reverse-engineer the format, so entries marked `observed: false`
 * are educated guesses based on Algoriddim's naming convention (the service
 * name in lowercase is used as both the URI scheme and the originSourceID).
 *
 * Verified: explorer, music, beatport, soundcloud, spotify
 * Inferred: beatsource, tidal, applemusic
 */

/** Every track source djay Pro is known (or believed) to support. */
export type DjayOriginSourceID =
  | 'explorer'
  | 'music'
  | 'beatport'
  | 'beatsource'
  | 'soundcloud'
  | 'spotify'
  | 'tidal'
  | 'applemusic';

export interface DjaySourceInfo {
  /** The originSourceID string as written by djay Pro. */
  id: DjayOriginSourceID;
  /** Whether this value was observed in a live djay Pro 5.6.4 session. */
  observed: boolean;
  /** `local` = file on disk; `streaming` = streaming service. */
  kind: 'local' | 'streaming';
  /** Human-readable display label. */
  label: string;
  /**
   * URI scheme prefix for tracks from this source in `sourceURIs`.
   * Undefined for local sources (which use `file://` URIs).
   */
  uriSchemePrefix?: string;
}

/**
 * Map of `originSourceID` → descriptive info. Callers can iterate this to
 * build dropdown lists, detection heuristics, or validation helpers.
 */
export const DJAY_SOURCES: Record<DjayOriginSourceID, DjaySourceInfo> = {
  explorer: {
    id: 'explorer',
    observed: true,
    kind: 'local',
    label: 'File Explorer',
  },
  music: {
    id: 'music',
    observed: true,
    kind: 'local',
    label: 'OS Music Library',
  },
  beatport: {
    id: 'beatport',
    observed: true,
    kind: 'streaming',
    label: 'Beatport',
    uriSchemePrefix: 'beatport:track:',
  },
  beatsource: {
    id: 'beatsource',
    observed: false,
    kind: 'streaming',
    label: 'Beatsource',
    uriSchemePrefix: 'beatsource:track:',
  },
  soundcloud: {
    id: 'soundcloud',
    observed: true,
    kind: 'streaming',
    label: 'SoundCloud',
    uriSchemePrefix: 'soundcloud:tracks:',
  },
  spotify: {
    id: 'spotify',
    observed: true,
    kind: 'streaming',
    label: 'Spotify',
    uriSchemePrefix: 'spotify:track:',
  },
  tidal: {
    id: 'tidal',
    observed: false,
    kind: 'streaming',
    label: 'TIDAL',
    uriSchemePrefix: 'tidal:track:',
  },
  applemusic: {
    id: 'applemusic',
    observed: false,
    kind: 'streaming',
    label: 'Apple Music',
    uriSchemePrefix: 'applemusic:track:',
  },
};

/**
 * Returns true if the given `originSourceID` represents a streaming service
 * (as opposed to a local file). Unknown values default to `false`.
 */
export function isStreamingSource(id: string | undefined): boolean {
  if (!id) return false;
  const info = DJAY_SOURCES[id as DjayOriginSourceID];
  return info?.kind === 'streaming';
}

/**
 * Narrow a djay Pro `originSourceID` to the nowplaying3 `streamingSource`
 * enum (`beatport | tidal | soundcloud | streaming-direct-play`). Services
 * that aren't in the nowplaying3 enum (Spotify, Beatsource, Apple Music)
 * map to `streaming-direct-play` as a generic fallback. Local sources
 * return `undefined`.
 */
export function toNowPlayingStreamingSource(
  id: string | undefined,
):
  | 'beatport'
  | 'tidal'
  | 'soundcloud'
  | 'streaming-direct-play'
  | undefined {
  if (!id) return undefined;
  switch (id) {
    case 'beatport':
      return 'beatport';
    case 'tidal':
      return 'tidal';
    case 'soundcloud':
      return 'soundcloud';
    case 'spotify':
    case 'beatsource':
    case 'applemusic':
      return 'streaming-direct-play';
    default:
      return undefined;
  }
}
