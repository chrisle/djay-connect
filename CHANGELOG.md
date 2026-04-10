# Changelog

## 2.0.0

- Rewrite around SQLite for cross-platform support (macOS and Windows)
- Read djay Pro's `MediaLibrary.db` (YapDatabase) directly instead of parsing `NowPlaying.txt`
- Parse TSAF blobs to extract `historySessionItems` (title, artist, duration, deck, timestamps)
- Extract `titleID`, `originSourceID`, and `isrc` from history items
- Resolve `titleID` against `localMediaItemLocations` / `globalMediaItemLocations` to surface file paths and streaming source URIs
- Decode URL-encoded `file://` URIs into absolute filesystem paths (Windows backslash handling included)
- Add `DJAY_SOURCES` catalog, `isStreamingSource`, and `toNowPlayingStreamingSource` helpers
- Add on-disk format reference under `docs/FORMAT.md`

## 1.0.0

- Initial release
- Monitor djay Pro's `NowPlaying.txt` file for track changes
- Event-driven API with `ready`, `poll`, `track`, and `error` events
- Pluggable logger interface
- Path detection utilities
