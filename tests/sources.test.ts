import { describe, expect, it } from 'vitest';
import {
  DJAY_SOURCES,
  isStreamingSource,
  toNowPlayingStreamingSource,
} from '../src/sources';

describe('sources', () => {
  describe('DJAY_SOURCES catalog', () => {
    it('includes all advertised djay Pro streaming services plus local sources', () => {
      const ids = Object.keys(DJAY_SOURCES).sort();
      expect(ids).toEqual(
        [
          'applemusic',
          'beatport',
          'beatsource',
          'explorer',
          'music',
          'soundcloud',
          'spotify',
          'tidal',
          'youtube',
        ].sort(),
      );
    });

    it('marks observed sources correctly', () => {
      expect(DJAY_SOURCES.explorer.observed).toBe(true);
      expect(DJAY_SOURCES.music.observed).toBe(true);
      expect(DJAY_SOURCES.beatport.observed).toBe(true);
      expect(DJAY_SOURCES.soundcloud.observed).toBe(true);
      expect(DJAY_SOURCES.spotify.observed).toBe(true);
      expect(DJAY_SOURCES.beatsource.observed).toBe(false);
      expect(DJAY_SOURCES.tidal.observed).toBe(false);
      expect(DJAY_SOURCES.applemusic.observed).toBe(false);
    });

    it('gives every streaming source a URI scheme prefix', () => {
      for (const info of Object.values(DJAY_SOURCES)) {
        if (info.kind === 'streaming') {
          expect(info.uriSchemePrefix).toBeDefined();
        } else {
          expect(info.uriSchemePrefix).toBeUndefined();
        }
      }
    });
  });

  describe('isStreamingSource', () => {
    it('returns true for streaming services', () => {
      expect(isStreamingSource('beatport')).toBe(true);
      expect(isStreamingSource('spotify')).toBe(true);
      expect(isStreamingSource('tidal')).toBe(true);
      expect(isStreamingSource('applemusic')).toBe(true);
      expect(isStreamingSource('youtube')).toBe(true);
    });

    it('returns false for local sources', () => {
      expect(isStreamingSource('explorer')).toBe(false);
      expect(isStreamingSource('music')).toBe(false);
    });

    it('returns false for unknown or missing values', () => {
      expect(isStreamingSource(undefined)).toBe(false);
      expect(isStreamingSource('')).toBe(false);
      expect(isStreamingSource('madeup')).toBe(false);
    });
  });

  describe('toNowPlayingStreamingSource', () => {
    it('passes through sources already in the nowplaying enum', () => {
      expect(toNowPlayingStreamingSource('beatport')).toBe('beatport');
      expect(toNowPlayingStreamingSource('tidal')).toBe('tidal');
      expect(toNowPlayingStreamingSource('soundcloud')).toBe('soundcloud');
    });

    it('maps non-enum streaming sources to streaming-direct-play', () => {
      expect(toNowPlayingStreamingSource('spotify')).toBe('streaming-direct-play');
      expect(toNowPlayingStreamingSource('beatsource')).toBe('streaming-direct-play');
      expect(toNowPlayingStreamingSource('applemusic')).toBe('streaming-direct-play');
      expect(toNowPlayingStreamingSource('youtube')).toBe('streaming-direct-play');
    });

    it('returns undefined for local sources', () => {
      expect(toNowPlayingStreamingSource('explorer')).toBeUndefined();
      expect(toNowPlayingStreamingSource('music')).toBeUndefined();
    });

    it('returns undefined for unknown or missing values', () => {
      expect(toNowPlayingStreamingSource(undefined)).toBeUndefined();
      expect(toNowPlayingStreamingSource('madeup')).toBeUndefined();
    });
  });
});
