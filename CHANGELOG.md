# Changelog

## v2.2.2

- ci: CI comes from the shared connector-ci workflows


## v2.2.1

- ci: djay Pro connector changes are tested before they reach main


## v2.2.0

- fix: djay Pro's SQLite driver is built again under npm 12, which blocks install scripts by default
- ci: the djay Pro addon build survives npm 12, which rejects --build-from-source as a flag
- ci: the djay Pro database tests run on CI instead of failing to find their SQLite addon
- ci: djay Pro releases reach npm again instead of dying on an unauthenticated publish
- chore: release v2.1.0
- fix: djay Pro releases publish again instead of failing on every push
- feat: djay Pro plays from YouTube are labelled as YouTube instead of an unknown source
- fix: keep djay Pro history items that have no artist
- build: bump better-sqlite3-multiple-ciphers to 12.11.1 for Electron 43
- chore: require better-sqlite3-multiple-ciphers ^12.9.0 for Electron 43
- fix: keep djay Pro overlays updating with live tracks instead of freezing on the previous session
- chore: drop transient peer:true flags from lock file


## v2.1.0

- fix: djay Pro releases publish again instead of failing on every push
- feat: djay Pro plays from YouTube are labelled as YouTube instead of an unknown source
- fix: keep djay Pro history items that have no artist
- build: bump better-sqlite3-multiple-ciphers to 12.11.1 for Electron 43
- chore: require better-sqlite3-multiple-ciphers ^12.9.0 for Electron 43
- fix: keep djay Pro overlays updating with live tracks instead of freezing on the previous session
- chore: drop transient peer:true flags from lock file


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
