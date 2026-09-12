import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractDouble,
  extractSourceURIs,
  extractString,
  extractTitleID,
  parseHistorySessionItem,
  parseMediaItemTitle,
} from '../src/tsaf';
import {
  HISTORY_ITEM_FIXTURES,
  fixtureBuffer,
  untaggedHistoryItem,
  withoutField,
} from './fixtures/historySessionItems';
import {
  MEDIA_ITEM_TITLE_FIXTURES,
  mediaItemTitleBuffer,
} from './fixtures/mediaItemTitleIDs';
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

    it('returns null when title, artist and titleID are all missing', () => {
      const emptyBlob = Buffer.from('TSAFnothinguseful');
      expect(parseHistorySessionItem(emptyBlob)).toBeNull();
    });

    it('keeps an item that has only a titleID, with empty strings', () => {
      // What djay Pro on macOS writes for an untagged file added via My
      // Files: the title lives in mediaItemTitleIDs, not in the history row.
      const fixture = untaggedHistoryItem(
        HISTORY_ITEM_FIXTURES[0],
        '0e64b1accf11337d40ca05b1800d64f3',
      );
      const blob = fixtureBuffer(fixture);
      expect(blob.length).toBeGreaterThanOrEqual(284);
      expect(blob.length).toBeLessThanOrEqual(316);

      const parsed = parseHistorySessionItem(blob);

      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe('');
      expect(parsed!.artist).toBe('');
      expect(parsed!.titleID).toBe('0e64b1accf11337d40ca05b1800d64f3');
      // The rest of the record still decodes around the gap.
      expect(parsed!.deckNumber).toBe(1);
      expect(parsed!.duration).toBeCloseTo(307.879, 3);
      expect(parsed!.originSourceID).toBe('explorer');
      expect(parsed!.uuid).toBe('212C5976-EB1D-8D0D-71F0-8E5D4B2ABA12');
    });

    it('keeps an item that has a title but no artist', () => {
      // What a music video looks like in the history: djay reads the title
      // from the file (or its name) and has no artist tag to read.
      const blob = withoutField(
        fixtureBuffer(HISTORY_ITEM_FIXTURES[0]),
        'artist',
      );
      const parsed = parseHistorySessionItem(blob);

      expect(parsed).not.toBeNull();
      expect(parsed!.title).toBe('Voodoo People (Pendulum Mix)');
      expect(parsed!.artist).toBe('');
      // The rest of the record still decodes around the gap.
      expect(parsed!.deckNumber).toBe(1);
      expect(parsed!.duration).toBeCloseTo(307.879, 3);
      expect(parsed!.originSourceID).toBe('explorer');
      expect(parsed!.uuid).toBe('212C5976-EB1D-8D0D-71F0-8E5D4B2ABA12');
    });

    it('keeps an item that has an artist but no title', () => {
      const blob = withoutField(
        fixtureBuffer(HISTORY_ITEM_FIXTURES[0]),
        'title',
      );
      const parsed = parseHistorySessionItem(blob);

      expect(parsed).not.toBeNull();
      expect(parsed!.artist).toBe('The Prodigy');
      expect(parsed!.title).toBe('');
    });
  });

  describe('parseMediaItemTitle', () => {
    it.each(MEDIA_ITEM_TITLE_FIXTURES)(
      'reads the strings djay shows for $expected.title',
      (fixture) => {
        const parsed = parseMediaItemTitle(mediaItemTitleBuffer(fixture));
        expect(parsed.title).toBe(fixture.expected.title);
        expect(parsed.artist).toBe(fixture.expected.artist);
      },
    );

    it('is keyed by the titleID it carries', () => {
      for (const fixture of MEDIA_ITEM_TITLE_FIXTURES) {
        expect(extractTitleID(mediaItemTitleBuffer(fixture))).toBe(fixture.key);
      }
    });

    it('returns empty strings for a blob with no title fields', () => {
      expect(parseMediaItemTitle(Buffer.from('TSAFnothinguseful'))).toEqual({
        title: '',
        artist: '',
      });
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
