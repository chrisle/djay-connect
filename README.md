# djay-connect

Library to read djay Pro's `MediaLibrary.db` and emit track change events.
Supports djay Pro on macOS and Windows.

## Installation

```bash
npm install djay-connect
```

## Usage

```typescript
import { DjayConnect } from 'djay-connect';

const djay = new DjayConnect({
  pollIntervalMs: 2000,
});

djay.on('ready', (info) => {
  console.log(`Watching: ${info.databasePath}`);
});

djay.on('track', (payload) => {
  const { track } = payload;
  console.log(`Now playing: ${track.artist} - ${track.title} [deck ${track.deckNumber}]`);
  if (track.filePath) console.log(`File: ${track.filePath}`);
  if (track.originSourceID) console.log(`Source: ${track.originSourceID}`);
});

djay.on('error', (err) => {
  console.error('Error:', err);
});

djay.start();

// Later...
djay.stop();
```

## API

### `new DjayConnect(options?)`

- `pollIntervalMs` — Polling interval in milliseconds (minimum 2000, default 2000)
- `databasePath` — Custom path to `MediaLibrary.db`. If omitted, uses the default per-platform path.
- `logger` — Logger instance implementing `{ trace, debug, info, warn, error }`

### Track fields

Every `track` event carries a `DjayNowPlayingTrack` with:

- `title`, `artist`, `duration`, `deckNumber`, `startTime`
- `uuid`, `sessionUUID` — history entry and session identifiers
- `titleID` — 32-hex id joining the track to location and analysis tables
- `originSourceID` — where the track came from (`explorer`, `music`, `beatport`,
  `soundcloud`, `spotify`, `tidal`, `beatsource`, `applemusic`)
- `isrc` — International Standard Recording Code (streaming tracks)
- `filePath` — absolute path for local files, decoded from djay's URL-encoded
  `file://` URIs
- `sourceURIs` — raw source URIs; may contain multiple entries when a track is
  available on more than one streaming service

### Events

- `ready` — Emitted when monitoring starts
- `poll` — Emitted on each poll cycle
- `track` — Emitted when a new track is detected
- `error` — Emitted on errors

### Detection utilities

- `getDefaultDjayInstallPath()` — Returns the default djay Pro data folder
- `getDefaultDatabasePath()` — Returns the default `MediaLibrary.db` path for
  the current platform
- `getDefaultDatabasePaths()` — Returns all candidate paths for the current
  platform
- `detectDjayInstallation()` — Checks whether djay Pro is installed

### Source helpers

- `DJAY_SOURCES` — Catalog of every known `originSourceID` with `kind`,
  `label`, and URI scheme prefix
- `isStreamingSource(id)` — True if the given source is a streaming service
- `toNowPlayingStreamingSource(id)` — Maps a djay Pro source to the
  nowplaying streaming enum

### TSAF parser (advanced)

- `parseHistorySessionItem(blob)` — Parse a raw `historySessionItems` BLOB
- `extractTitleID(blob)` — Extract the nested `ADCMediaItemTitleID`
- `extractSourceURIs(blob)` — Extract all source URIs from a location blob
- `extractString`, `extractDouble`, `extractDate` — Low-level field readers

See [`docs/FORMAT.md`](docs/FORMAT.md) for the full on-disk format reference.

## License

MIT
