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

/** Shape of the fields we extract from a historySessionItems blob. */
export interface DjayHistoryItemFields {
  uuid: string;
  sessionUUID: string;
  title: string;
  artist: string;
  duration: number;
  deckNumber: number;
  startTime: Date;
}

/**
 * Parse a historySessionItems blob into a typed record.
 * Returns `null` if the blob is missing required fields (title or artist).
 */
export function parseHistorySessionItem(
  blob: Buffer,
): DjayHistoryItemFields | null {
  const title = extractString(blob, 'title');
  const artist = extractString(blob, 'artist');
  if (!title || !artist) return null;

  const uuid = extractString(blob, 'uuid') ?? '';
  const sessionUUID = extractString(blob, 'sessionUUID') ?? '';
  const duration = extractDouble(blob, 'duration') ?? 0;
  const deckRaw = extractDouble(blob, 'deckNumber') ?? 0;
  const deckNumber = Number.isFinite(deckRaw) ? Math.round(deckRaw) : 0;
  const startTime = extractDate(blob, 'startTime') ?? new Date(0);

  return {
    uuid,
    sessionUUID,
    title,
    artist,
    duration,
    deckNumber,
    startTime,
  };
}
