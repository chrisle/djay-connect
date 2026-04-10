import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractDouble,
  extractString,
  parseHistorySessionItem,
} from '../src/tsaf';
import {
  HISTORY_ITEM_FIXTURES,
  fixtureBuffer,
} from './fixtures/historySessionItems';

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
      },
    );

    it('returns null when title and artist are both missing', () => {
      const emptyBlob = Buffer.from('TSAFnothinguseful');
      expect(parseHistorySessionItem(emptyBlob)).toBeNull();
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
});
