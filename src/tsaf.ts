/**
 * @fileoverview Minimal parser for Algoriddim's TSAF serialization format used inside
 * djay Pro's MediaLibrary.db (YapDatabase `database2.data` column).
 *
 * TSAF records are a stream of typed values, where each value is followed by its key:
 *
 *   `<value bytes> 0x08 <key-ascii> 0x00`
 *
 * Known value tags:
 *   - `0x08 <utf8-bytes> 0x00`  — UTF-8 string
 *   - `0x14` + 8-byte little-endian IEEE 754 double (present as the 8 bytes immediately
 *     preceding the key tag, regardless of any leading padding/subtype bytes)
 *   - `0x30` + 8-byte little-endian CFAbsoluteTime double (seconds since 2001-01-01 UTC)
 *
 * We only need to extract a handful of known fields (title, artist, deckNumber, etc.),
 * so rather than fully parsing the container, we locate each key tag and read the
 * preceding value bytes according to the expected type. This approach has been verified
 * against real `historySessionItems` rows on djay Pro for Windows.
 */

/** CFAbsoluteTime epoch: 2001-01-01 00:00:00 UTC in milliseconds since Unix epoch. */
const CF_EPOCH_MS = Date.UTC(2001, 0, 1, 0, 0, 0);

const STRING_TAG = 0x08;

/** Maximum bytes to walk backwards when resolving a string value. */
const MAX_STRING_SCAN = 2048;

function findKey(blob: Buffer, key: string): number {
  const needle = Buffer.alloc(key.length + 2);
  needle[0] = STRING_TAG;
  needle.write(key, 1, 'ascii');
  needle[needle.length - 1] = 0x00;
  return blob.indexOf(needle);
}

/** Read an 8-byte little-endian double that sits immediately before the given key tag. */
function readDoubleBeforeKey(blob: Buffer, keyPos: number): number | undefined {
  if (keyPos < 8) return undefined;
  return blob.readDoubleLE(keyPos - 8);
}

/**
 * Read a UTF-8 string value that precedes the given key tag.
 * The value is encoded as `0x08 <utf8-bytes> 0x00` immediately before the key.
 */
function readStringBeforeKey(blob: Buffer, keyPos: number): string | undefined {
  if (keyPos < 2) return undefined;
  const nullPos = keyPos - 1;
  if (blob[nullPos] !== 0x00) return undefined;

  const scanLimit = Math.max(0, nullPos - MAX_STRING_SCAN);
  for (let i = nullPos - 1; i >= scanLimit; i--) {
    if (blob[i] !== STRING_TAG) continue;
    const value = blob.subarray(i + 1, nullPos);
    if (!isPrintableUtf8(value)) continue;
    return value.toString('utf-8');
  }
  return undefined;
}

function isPrintableUtf8(bytes: Buffer): boolean {
  for (const b of bytes) {
    // Allow common UTF-8 continuation/lead bytes (>= 0x80) and printable ASCII.
    // Reject control characters except tab (rare in titles but allow for safety).
    if (b === 0x09) continue;
    if (b >= 0x20 && b < 0x7f) continue;
    if (b >= 0x80) continue;
    return false;
  }
  return true;
}

/** Extract a single typed field from a TSAF blob, or return undefined if not present. */
export function extractString(blob: Buffer, key: string): string | undefined {
  const pos = findKey(blob, key);
  if (pos < 0) return undefined;
  return readStringBeforeKey(blob, pos);
}

export function extractDouble(blob: Buffer, key: string): number | undefined {
  const pos = findKey(blob, key);
  if (pos < 0) return undefined;
  return readDoubleBeforeKey(blob, pos);
}

export function extractDate(blob: Buffer, key: string): Date | undefined {
  const pos = findKey(blob, key);
  if (pos < 0) return undefined;
  const cfAbsolute = readDoubleBeforeKey(blob, pos);
  if (cfAbsolute === undefined || !Number.isFinite(cfAbsolute)) return undefined;
  return new Date(CF_EPOCH_MS + cfAbsolute * 1000);
}

/**
 * Extract the nested `ADCMediaItemTitleID` — the 32-hex string that joins a
 * history item to its row in `localMediaItemLocations` / `globalMediaItemLocations`
 * / `mediaItemTitleIDs` / `mediaItemAnalyzedData` etc.
 *
 * Inside a TSAF blob the nested class looks like:
 *
 *   `0x2B 0x08 'ADCMediaItemTitleID' 0x00 0x08 <32-hex chars> 0x00 ...`
 *
 * We locate the class marker and read the tagged string that immediately
 * follows it.
 */
export function extractTitleID(blob: Buffer): string | undefined {
  const marker = Buffer.concat([
    Buffer.from([0x2b, 0x08]),
    Buffer.from('ADCMediaItemTitleID', 'ascii'),
    Buffer.from([0x00]),
  ]);
  const markerPos = blob.indexOf(marker);
  if (markerPos < 0) return undefined;
  const stringTagPos = markerPos + marker.length;
  if (blob[stringTagPos] !== 0x08) return undefined;
  const stringStart = stringTagPos + 1;
  const stringEnd = blob.indexOf(0x00, stringStart);
  if (stringEnd < 0) return undefined;
  const candidate = blob.subarray(stringStart, stringEnd).toString('ascii');
  // Sanity check: titleIDs are 32-char lowercase hex.
  if (!/^[0-9a-f]{32}$/.test(candidate)) return undefined;
  return candidate;
}

/** Shape of the fields we extract from a historySessionItems blob. */
export interface DjayHistoryItemFields {
  uuid: string;
  sessionUUID: string;
  /** 32-char hex titleID that joins into the location / analysis tables. */
  titleID: string | undefined;
  title: string;
  artist: string;
  duration: number;
  deckNumber: number;
  startTime: Date;
  /** djay Pro's source identifier (e.g. 'explorer', 'spotify', 'beatport'). */
  originSourceID: string | undefined;
  /** International Standard Recording Code — present on streaming tracks. */
  isrc: string | undefined;
}

/**
 * Parse a historySessionItems blob into a typed record.
 * Returns `null` if both title and artist are missing.
 * Allows empty artist — streaming sources like YouTube may only have a title.
 */
export function parseHistorySessionItem(
  blob: Buffer,
): DjayHistoryItemFields | null {
  const title = extractString(blob, 'title');
  const artist = extractString(blob, 'artist');
  if (!title && !artist) return null;

  const uuid = extractString(blob, 'uuid') ?? '';
  const sessionUUID = extractString(blob, 'sessionUUID') ?? '';
  const titleID = extractTitleID(blob);
  const duration = extractDouble(blob, 'duration') ?? 0;
  const deckRaw = extractDouble(blob, 'deckNumber') ?? 0;
  const deckNumber = Number.isFinite(deckRaw) ? Math.round(deckRaw) : 0;
  const startTime = extractDate(blob, 'startTime') ?? new Date(0);
  const originSourceID = extractString(blob, 'originSourceID');
  const isrc = extractString(blob, 'isrc');

  return {
    uuid,
    sessionUUID,
    titleID,
    title: title ?? '',
    artist: artist ?? '',
    duration,
    deckNumber,
    startTime,
    originSourceID,
    isrc,
  };
}

/**
 * Extract the `sourceURIs` strings from a `localMediaItemLocations` or
 * `globalMediaItemLocations` blob. A single location record can carry more
 * than one URI — e.g. *Good Catch (Black Caviar Remix)* in the test session
 * has both `soundcloud:tracks:1150488265` and `beatport:track:15949981`.
 *
 * Each URI is stored as a distinctive `0x21 0x08 <utf8 bytes> 0x00` sequence,
 * wrapped in an array header `0x0B 0x00 0x00 <count> 0x00 0x00 0x00`. The
 * array immediately precedes a `0x08 'sourceURIs' 0x00` key tag. Rather than
 * fully decoding the array framing, we scan forward through the blob for any
 * `0x21 0x08 <uri> 0x00` pattern that sits *before* the key and return all
 * matches in order.
 */
export function extractSourceURIs(blob: Buffer): string[] {
  const keyNeedle = Buffer.concat([
    Buffer.from([0x08]),
    Buffer.from('sourceURIs', 'ascii'),
    Buffer.from([0x00]),
  ]);
  const keyPos = blob.indexOf(keyNeedle);
  if (keyPos < 0) return [];

  const uris: string[] = [];
  const window = blob.subarray(0, keyPos);
  // Each element starts with `0x21 0x08 <utf8 bytes> 0x00`. Scan for the
  // two-byte prefix, then read until the next 0x00.
  for (let i = 0; i < window.length - 2; i++) {
    if (window[i] !== 0x21 || window[i + 1] !== 0x08) continue;
    const stringStart = i + 2;
    const stringEnd = window.indexOf(0x00, stringStart);
    if (stringEnd < 0) break;
    const candidate = window.subarray(stringStart, stringEnd).toString('utf-8');
    // Must look like a URI — contain a scheme colon and be at least 5 chars.
    if (candidate.length < 5 || candidate.indexOf(':') <= 0) {
      i = stringEnd;
      continue;
    }
    uris.push(candidate);
    i = stringEnd;
  }
  return uris;
}
