# djay-connect

Library to read algoriddim djay Pro's NowPlaying.txt file and emit track change events.

## Installation

```bash
npm install djay-connect
```

## Usage

```typescript
import { DjayConnect } from 'djay-connect';

const djay = new DjayConnect({
  pollIntervalMs: 5000,
});

djay.on('ready', (info) => {
  console.log(`Watching: ${info.nowPlayingPath}`);
});

djay.on('track', (payload) => {
  console.log(`Now playing: ${payload.track.artist} - ${payload.track.title}`);
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

- `pollIntervalMs` — Polling interval in milliseconds (minimum 5000, default 5000)
- `nowPlayingPath` — Custom path to NowPlaying.txt (default: `~/Music/djay/djay Media Library.djayMediaLibrary/NowPlaying.txt`)
- `logger` — Logger instance implementing `{ trace, debug, info, warn, error }`

### Events

- `ready` — Emitted when monitoring starts
- `poll` — Emitted on each poll cycle
- `track` — Emitted when a new track is detected
- `error` — Emitted on errors

### Detection Utilities

- `getDefaultNowPlayingPath()` — Returns the default NowPlaying.txt path
- `getDefaultDjayInstallPath()` — Returns the default djay install path
- `detectDjayInstallation()` — Checks if djay Pro is installed

## License

MIT
