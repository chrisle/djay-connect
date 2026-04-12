import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractDouble,
  extractSourceURIs,
  extractString,
  extractTitleID,
  parseHistorySessionItem,
} from '../src/tsaf';
import {
  HISTORY_ITEM_FIXTURES,
  fixtureBuffer,
} from './fixtures/historySessionItems';
import {
  LOCATION_FIXTURES,
  locationBuffer,
} from './fixtures/mediaItemLocations';

describe('tsaf', () => {
  describe('parseHistorySessionItem', () => {
    it.each(HISTORY_ITEM_FIXTURES)(
      'decodes $expected.title correctly',
      (fixture) => {
        const blob = fixtureBuffer(fixture);
        const parsed = parseHistorySessionItem(blob);
        expect(parsed).not.toBeNull();
        expect(parsed!.title).toBe(fixture.expected.title);
        expect(parsed!.artist).toBe(fixture.expected.artist);
        expect(parsed!.deckNumber).toBe(fixture.expected.deckNumber);
        expect(parsed!.uuid).toBe(fixture.expected.uuid);
        expect(parsed!.sessionUUID).toBe(fixture.expected.sessionUUID);
        expect(parsed!.duration).toBeCloseTo(
          fixture.expected.durationSeconds,
          3,
        );
        expect(parsed!.originSourceID).toBe(fixture.expected.originSourceID);
        if (fixture.expected.isrc !== undefined) {
          expect(parsed!.isrc).toBe(fixture.expected.isrc);
        }
      },
    );

    it('returns null when title and artist are both missing', () => {
      const emptyBlob = Buffer.from('TSAFnothinguseful');
      expect(parseHistorySessionItem(emptyBlob)).toBeNull();
    });

    it('parses a track with title but no artist (e.g. YouTube video)', () => {
      // Build a minimal TSAF blob containing only a title field, no artist.
      // TSAF value format: 0x08 <utf8-string> 0x00  then  0x08 <key> 0x00
      const titleValue = 'Daft Punk - Get Lucky (Official Video)';
      const titleField = Buffer.concat([
        Buffer.from([0x08]),
        Buffer.from(titleValue, 'utf-8'),
        Buffer.from([0x00]),
        Buffer.from([0x08]),
        Buffer.from('title', 'ascii'),
        Buffer.from([0x00]),
      ]);
      const parsed = parseHistorySessionItem(titleField);
      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe(titleValue);
      expect(parsed!.artist).toBe('');
    });

    it('parses a track with artist but no title', () => {
      const artistValue = 'Daft Punk';
      const artistField = Buffer.concat([
        Buffer.from([0x08]),
        Buffer.from(artistValue, 'utf-8'),
        Buffer.from([0x00]),
        Buffer.from([0x08]),
        Buffer.from('artist', 'ascii'),
        Buffer.from([0x00]),
      ]);
      const parsed = parseHistorySessionItem(artistField);
      expect(parsed).not.toBeNull();
      expect(parsed!.artist).toBe(artistValue);
      expect(parsed!.title).toBe('');
    });
  });

  describe('extractString', () => {
    it('locates a tagged string field by key', () => {
      const blob = fixtureBuffer(HISTORY_ITEM_FIXTURES[0]);
      expect(extractString(blob, 'title')).toBe('Voodoo People (Pendulum Mix)');
      expect(extractString(blob, 'artist')).toBe('The Prodigy');
    });

    it('returns undefined when the key is absent', () => {
      const blob = fixtureBuffer(HISTORY_ITEM_FIXTURES[0]);
      expect(extractString(blob, 'nonexistentField')).toBeUndefined();
    });
  });

  describe('extractDouble', () => {
    it('reads deck number as a double immediately before the key tag', () => {
      for (const fixture of HISTORY_ITEM_FIXTURES) {
        const blob = fixtureBuffer(fixture);
        expect(extractDouble(blob, 'deckNumber')).toBe(
          fixture.expected.deckNumber,
        );
      }
    });

    it('reads duration in seconds', () => {
      const blob = fixtureBuffer(HISTORY_ITEM_FIXTURES[0]);
      const duration = extractDouble(blob, 'duration');
      expect(duration).toBeDefined();
      expect(duration!).toBeCloseTo(307.879, 2);
    });
  });

  describe('extractDate', () => {
    it('converts CFAbsoluteTime to a JS Date', () => {
      const blob = fixtureBuffer(HISTORY_ITEM_FIXTURES[0]);
      const startTime = extractDate(blob, 'startTime');
      expect(startTime).toBeInstanceOf(Date);
      // Snapshot was captured during a session in April 2026.
      expect(startTime!.getUTCFullYear()).toBe(2026);
      expect(startTime!.getUTCMonth()).toBe(3); // April (0-indexed)
    });
  });

  describe('extractTitleID', () => {
    it('returns the 32-hex titleID nested inside a history item', () => {
      for (const fixture of HISTORY_ITEM_FIXTURES) {
        const blob = fixtureBuffer(fixture);
        const id = extractTitleID(blob);
        expect(id).toMatch(/^[0-9a-f]{32}$/);
      }
    });

    it('returns the correct titleID for Voodoo People', () => {
      const blob = fixtureBuffer(HISTORY_ITEM_FIXTURES[0]);
      expect(extractTitleID(blob)).toBe('307b767ff2463cce064180664e6b4c89');
    });

    it('returns undefined when the marker is missing', () => {
      expect(extractTitleID(Buffer.from('not a TSAF blob'))).toBeUndefined();
    });
  });

  describe('extractSourceURIs', () => {
    it('returns a single file:// URI for a local track', () => {
      const local = LOCATION_FIXTURES.find(
        (f) => f.collection === 'localMediaItemLocations',
      )!;
      const blob = locationBuffer(local);
      expect(extractSourceURIs(blob)).toEqual(local.expected.sourceURIs);
    });

    it('returns a single streaming URI for a Beatport-only track', () => {
      const beatport = LOCATION_FIXTURES.find(
        (f) => f.key === 'f19cbc67ffa03730d4ba9261861f699d',
      )!;
      const blob = locationBuffer(beatport);
      expect(extractSourceURIs(blob)).toEqual(beatport.expected.sourceURIs);
    });

    it('returns multiple URIs for a track available on multiple services', () => {
      const multi = LOCATION_FIXTURES.find(
        (f) => f.key === 'dd4e91fdf5dc9a469c5e3b9588de228b',
      )!;
      const blob = locationBuffer(multi);
      expect(extractSourceURIs(blob)).toEqual(multi.expected.sourceURIs);
    });

    it('returns an empty array when sourceURIs key is missing', () => {
      expect(extractSourceURIs(Buffer.from('nothing'))).toEqual([]);
    });
  });
});
