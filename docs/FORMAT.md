# djay Pro on-disk format reference

A comprehensive map of everything djay Pro writes to disk that `djay-connect`
cares about (or might care about in the future). Reverse-engineered from **djay
Pro 5.6.4** for Windows against a live session. The same layout applies to
macOS; the container folder name is the only platform difference.

- `djay Pro for Windows 5.6.4` — verified against a live, running session
- `djay Pro for macOS` — unverified, assumed identical based on YapDatabase/TSAF schema

## Filesystem layout

### Library (what `djay-connect` currently reads)

```
macOS    ~/Music/djay/djay Media Library.djayMediaLibrary/MediaLibrary.db
Windows  %USERPROFILE%\Music\djay\djay Media Library\MediaLibrary.db
```

This is a SQLite database (in WAL mode while djay Pro is running) containing
the library, analyzed-track index, playlists, queue, and — most importantly for
now-playing — a rolling history of played tracks. See *MediaLibrary.db schema*
below.

djay Pro automatically writes a daily backup to
`~/Music/djay/Backups/YYYY-MM-DD/djay Media Library/MediaLibrary.db`.

### Per-track analysis cache (waveforms + beatgrids + keys)

```
<djay-app-data>/Metadata/<first-2-hex-of-titleID>/<titleID>.djayMetadata
```

Each file is an **Apple binary plist** (`bplist00` magic). One file per unique
track the app has seen. The 32-hex `titleID` matches the key in the
`mediaItemTitleIDs` collection of `MediaLibrary.db`, so you can join history
entries straight to their waveform file.

See *.djayMetadata structure* below for field details — this is where the full
waveform samples, color-coded waveform, AI-generated beatgrid, musical key
analysis, and auto-gain values live.

### Streaming-service caches

| Service | Cache path | Notes |
|---|---|---|
| Beatport | `<djay-app-data>/Beatport/__guest/sqlite3.db` | SQLite cache with full Beatport API JSON per track |
| Beatport | `<djay-app-data>/Beatport/__guest/tr/<beatport-id>.trk` | Per-track encrypted audio/waveform cache (~1.4 MB each, not plaintext) |
| Beatport | `<djay-app-data>/Beatport/d.txt` | Single UUID line — anonymous device identifier |
| Beatsource | `<djay-app-data>/Beatsource/d.txt` | Same format as Beatport — anonymous device UUID |

No dedicated folder is created for Spotify/SoundCloud/Tidal — those services
rely on the streaming platform's own API and only leave traces in
`historySessionItems`/`globalMediaItemLocations` (inside `MediaLibrary.db`) and
the preferences file.

The `__guest` subdirectory is used while the user is signed out; after sign-in
djay Pro creates a second subdirectory keyed on the authenticated user id.

### Preferences

```
<djay-app-data>/Preferences/com.algoriddim.djay-windows.plist   (Windows)
<djay-app-data>/Preferences/com.algoriddim.djay.plist           (macOS, assumed)
```

Apple binary plist, ~7 KB. Holds **all** user settings. Highlights relevant to
an integration:

- `ALWExplorerSourceFolders` — user's configured local music folders (e.g. `D:\NP3-TEST-MP3`)
- `ARStreamingServicesLoggedIn` — list of logged-in streaming services (e.g. `['Spotify']`)
- `ARCSpotifyDeviceIdentifier` — Spotify Connect device ID
- `DJInstantFXType1..8`, `DJInstantFXMainType1..2` — instant-FX slot assignments
- `DJTurntable{1..4}AudioFX{1..3}Type`, `DJTurntable{1..4}AudioPADFXType` — per-deck FX assignments (so djay Pro supports 4 decks with 3 FX slots + 1 pad FX slot each)
- `DJMainWindowGeometry` — window bounds
- `DJMainWindowIsFullScreen`
- `DJShouldQuantizeSliceJump`
- `ALCBeatportClearCachedTracks`
- `ANALYTICS_NR_OF_SONGS_LOADED`, `ARAlgoriddimAnalytics.GA*` — Google Analytics session counters
- `ARAppRater.applicationVersion` — currently-installed djay Pro version
- `ARUnmixerModelVersion` — version of the AI unmixer model (stem separation)
- `com.revenuecat.userdefaults.appUserID.new` — **RevenueCat** anonymous user id. djay Pro uses RevenueCat for subscription management.
- `CMCMediaSourceViewState:music` → `com.microsoft.music.Playlists` — djay Pro on Windows integrates with the Microsoft Media Player / Groove app as a local music source
- `CMCMediaLibraryContentViewState.selectedMediaSourceIdentifier` — last-viewed media source tab (`'spotify'`, `'beatport'`, `'music'`, `'explorer'`, `'user'`)

### Other paths under `<djay-app-data>/`

| Path | What it is |
|---|---|
| `LocalCache/Local/firebase-heartbeat/` | Firebase SDK telemetry heartbeats |
| `cache/Sentry/` | Sentry crash reporting breadcrumbs, sessions, and events |
| `cache/_qt_QGfxShaderBuilder_6.10.2/` | Qt 6.10 shader cache — **confirms djay Pro Windows is built on Qt** |
| `cache/qtpipelinecache-x86_64-little_endian-llp64/` | Qt graphics pipeline cache |
| `Settings/settings.dat` | UWP `LocalSettings` binary store (opaque) |

### Windows UWP app data root

On Windows, djay Pro is a Microsoft Store / UWP application. Everything under
`<djay-app-data>` above actually lives at:

```
%LOCALAPPDATA%\Packages\59BEBC1A.djay_e3tqh12mt5rj6\LocalCache\Local\Algoriddim\djay\
```

The `59BEBC1A.djay_e3tqh12mt5rj6` package name is the publisher hash + family
name assigned by the Store. The corresponding runnable executable is
`djayApp.exe` (what `djay-connect` uses for process-running detection).

The parallel `%LOCALAPPDATA%\Packages\<pkg>\Settings\settings.dat` file is the
UWP `LocalSettings` binary container; djay Pro writes most of its real settings
into the plist file above instead.

## MediaLibrary.db schema

`MediaLibrary.db` is a [YapDatabase](https://github.com/yapstudios/YapDatabase)
file (Yap was written for iOS/macOS but the schema is just SQLite tables, so it
works unchanged on Windows). The main table is `database2`, which is a
collection-keyed BLOB store:

```sql
CREATE TABLE database2 (
  rowid      INTEGER PRIMARY KEY,
  collection CHAR NOT NULL,
  key        CHAR NOT NULL,
  data       BLOB,         -- TSAF-encoded payload
  metadata   BLOB          -- always NULL in practice
);
```

Every other table is either an index (`secondaryIndex_*`), a paged view
(`view_*`), a full-text index (`fts_*`), or YapDatabase extension bookkeeping
(`yap2`, `relationship_relationship`).

Each row's `data` column is a TSAF blob (see *TSAF format* at the bottom). The
combination of `(collection, key)` uniquely identifies a record.

### Collections

| Collection | Rows (sample) | Purpose | Key format |
|---|---:|---|---|
| `databaseInfo` | 3 | `modelVersion`, `formatVersion`, `platform` — stored as NSKeyedArchiver bplists (not TSAF) | plain name |
| `historySessions` | 1 | One row per playback session (usually just "today") | session UUID |
| `historySessionItems` | 7 | One row per track played in any session — the primary input for now-playing | item UUID |
| `queues` | 1 | djay Pro's internal track queue (usually empty) | `queue-default` |
| `mediaItemTitleIDs` | 26 | One row per unique (title, artist) in the library | titleID (32 hex) |
| `mediaItemAnalyzedData` | 26 | BPM + key index + "is straight grid" flag per titleID | titleID (32 hex) |
| `mediaItemUserData` | 7 | Per-titleID play count, ratings, tags | titleID (32 hex) |
| `mediaItemPlaylists` | 1 | djay-managed playlists; the root has `name='Playlists'` | `mediaItemPlaylist-root` or playlist UUID |
| `localMediaItemLocations` | 4 | File URIs for tracks that exist as local files | titleID (32 hex) |
| `globalMediaItemLocations` | 3 | URIs for streaming-only tracks | titleID (32 hex) |
| `contentPacks` | 99 | Loopmasters sample/loop packs available in djay Pro's Looper | `looper-pack-<slug>` |
| `contentPackMediaItems` | 64 | Individual loops/samples inside the content packs | content item UUID |

### TSAF fields, by collection

All fields share the TSAF encoding rules below. "Type" is the TSAF tag used.

#### `historySessions` — `ADCHistorySession`

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Session UUID |
| `deviceName` | string | Host machine name (e.g. `'wutdafuq'` for this test session) |
| `deviceType` | double | Numeric device type enum |
| `startDate` | date | CFAbsoluteTime seconds since 2001-01-01 |
| `endDate` | date | CFAbsoluteTime — updated live while the session is active |
| `itemUUIDs` | array of strings | Ordered list of the history item UUIDs in this session |

#### `historySessionItems` — `ADCHistorySessionItem`  ← *primary now-playing source*

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Per-item UUID (matches one entry in the parent session's `itemUUIDs`) |
| `sessionUUID` | string | Backreference to the enclosing `historySessions` row |
| `titleID` | object ref | Nested `ADCMediaItemTitleID` — carries the 32-hex titleID that joins into `mediaItem*` and `*MediaItemLocations` |
| `title` | string | Denormalized title (also lives on the title ID) |
| `artist` | string | Denormalized artist |
| `duration` | double | Track length in seconds |
| `deckNumber` | double | 1, 2, 3, or 4 — which deck the track was loaded on |
| `startTime` | date | When the track was started |
| `isrc` | string | International Standard Recording Code — present for streaming tracks, absent on most local files |
| `originSourceID` | string | One of: `explorer`, `music`, `beatport`, `soundcloud`, `spotify`, `beatsource`, `tidal` — where the track came from |

**`originSourceID` values.**
djay Pro for Windows 5.6.4 advertises integrations with six streaming services
on the [Algoriddim product page](https://www.algoriddim.com/djay-pro-windows)
plus two local sources. The table below marks the values that were observed in
a live session with ✓; the remaining entries are educated guesses based on the
scheme naming convention (djay uses the lowercase service name as both the URI
scheme and the `originSourceID`).

| Value | Kind | Observed | Meaning |
|---|---|:---:|---|
| `explorer` | local | ✓ | Local file browsed via djay's File Explorer tab |
| `music` | local | ✓ | OS music library — Apple Music / Music app on macOS, Microsoft Media Player / Groove on Windows. Tracks here are local files in the user's music folder. |
| `beatport` | streaming | ✓ | Beatport |
| `soundcloud` | streaming | ✓ | SoundCloud |
| `spotify` | streaming | ✓ | Spotify |
| `beatsource` | streaming | | Beatsource — inferred from presence of `<djay-app-data>/Beatsource/` cache folder |
| `tidal` | streaming | | TIDAL — inferred from the product page |
| `applemusic` | streaming | | Apple Music — inferred from the product page. The exact `originSourceID` is unverified; djay may also use `apple-music`, `apple`, or reuse `music` on macOS for both the local library and the streaming service. Handle defensively. |

#### `localMediaItemLocations` — `ADCMediaItemLocation` (local variant)

Keyed by titleID. Carries the actual on-disk path for local-file tracks.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Matches the row's titleID key |
| `titleIDs` | object ref | Nested `ADCMediaItemTitleID` |
| `title` | string | |
| `artist` | string | |
| `duration` | double | |
| `sourceURIs` | string (array) | `file://`-scheme URIs, URL-encoded. On Windows looks like `file:///D:%5CNP3-TEST-MP3%5CVoodoo_People.mp3` |

#### `globalMediaItemLocations` — `ADCMediaItemLocation` (streaming variant)

Keyed by titleID. Present when the track lives on a streaming service.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Matches the row's titleID key |
| `titleIDs` | object ref | Nested `ADCMediaItemTitleID` |
| `title` | string | |
| `artist` | string | |
| `duration` | double | |
| `isrc` | string | Usually present for streaming tracks |
| `sourceURIs` | string (can be multiple) | Streaming URIs in the form `<service>:<resource>:<id>`. A single track can have multiple URIs — e.g. the test session's *Good Catch* has both `soundcloud:tracks:1150488265` **and** `beatport:track:15949981` |
| `type` | double | Numeric location-type flag (1.0 = streaming, observed) |

**URI schemes.** Observed values marked ✓; others inferred from the service
name and naming convention.

| Scheme | Observed | Example |
|---|:---:|---|
| `beatport:track:<id>` | ✓ | `beatport:track:24508685` |
| `soundcloud:tracks:<id>` | ✓ | `soundcloud:tracks:1150488265` (note the plural `tracks`) |
| `spotify:track:<base62>` | ✓ | `spotify:track:36BMQ2DTuqIXeP5KhBu1ao` |
| `beatsource:track:<id>` | | Inferred — same format as Beatport |
| `tidal:track:<id>` | | Inferred — matches TIDAL's public URI convention |
| `applemusic:track:<id>` or `apple-music:track:<id>` | | Inferred — exact scheme unverified |

A single track may have **multiple** source URIs when the same song is
available on more than one service (e.g. *Good Catch* from the test session
has both `soundcloud:tracks:1150488265` and `beatport:track:15949981`).

#### `mediaItemTitleIDs` — `ADCMediaItemTitleID`

One row per unique track identity (title + artist). The key is the 32-hex
titleID used everywhere else.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | 32-hex titleID |
| `title` | string | |
| `artist` | string | |
| `duration` | double | |

#### `mediaItemAnalyzedData` — `ADCMediaItemAnalyzedData`

Compact per-titleID analysis. For the full waveform + deep beatgrid, see the
`.djayMetadata` file instead.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | titleID |
| `titleIDs` | object ref | |
| `title` / `artist` / `duration` | — | Denormalized |
| `bpm` | double | |
| `keySignatureIndex` | double | djay's internal key index (see *Key index* below) |
| `isStraightGrid` | double | 1.0 if the track has a single fixed BPM, 0.0 if beatgrid is variable |

#### `mediaItemUserData` — `ADCMediaItemUserData`

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | titleID |
| `titleIDs` | object ref | |
| `title` / `artist` / `duration` | — | Denormalized |
| `playCount` | double | Number of times the user has played the track |

Other user-data fields (rating, tags, color) exist in djay Pro's model but
haven't been observed yet in a populated state.

#### `mediaItemPlaylists` — `ADCMediaItemPlaylist`

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Playlist UUID or `mediaItemPlaylist-root` for the root |
| `name` | string | User-facing name |
| `type` | double | Playlist-type enum |

#### `queues` — `ADCQueue`

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Queue identifier (usually the literal `queue-default`) |

Queue contents (track refs) appear in this blob too but were empty in the test
session, so the field name isn't confirmed yet.

#### `contentPacks` — `ADCLooperPack`

Loopmasters sample packs bundled with / downloaded by djay Pro.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | e.g. `looper-pack-deeper-house-124` |
| `name` | string | Display name (`'Deep House'`) |
| `summary` | string | Vendor / curator (`'Loopmasters'`) |
| `duration` | double | Length of the full pack preview |
| `bpm` | double | Native BPM of the pack |
| `keySignatureIndex` | double | |
| `access`, `owner`, `source`, `state` | — | Licensing / install state |
| `automaticallyInstall` | double | |
| `previewURL` | string | CloudFront preview audio URL |
| `imageURL` | string | CloudFront artwork URL |
| *(array of UUIDs)* | strings | The `contentPackMediaItems` keys for every loop in the pack |

The preview/image URLs point at Algoriddim's CloudFront distribution
(`d20j3xup5yq5o5.cloudfront.net/djay-content-packs/assets/...`).

#### `contentPackMediaItems` — `ADCContentPackMediaItem`

One row per individual loop or one-shot inside a content pack.

| Field | Type | Notes |
|---|---|---|
| `uuid` | string | Content item UUID |
| `fileName` | string | e.g. `'Kicks 1.flac'` |
| `category` | string | e.g. `'Drums'` |
| `contentPackUUID` | string | Parent pack |
| `bpm` | double | |

### Collection relationships

```
historySessions (1) ────── itemUUIDs ─────▶ historySessionItems (N)
                                                    │
                                                    │ titleID (32 hex)
                                                    ▼
                                         mediaItemTitleIDs (1)
                                                    │
                   ┌────────────────┬───────────────┼───────────────┬────────────────┐
                   ▼                ▼               ▼               ▼                ▼
           mediaItemAnalyzed   mediaItemUser   localMediaItem   globalMediaItem   .djayMetadata
              Data               Data            Locations        Locations        (per-file,
           (bpm/key)          (playCount)     (file:// URIs)   (streaming URIs)   waveform)

contentPacks (1) ─── contains ──▶ contentPackMediaItems (N)
```

## TSAF format

**T**SAF = Algoriddim's custom typed-serialization format, used for every `data`
blob inside `database2`. Magic bytes `TSAF` (`54 53 41 46`). Not bplist, not
NSKeyedArchiver, not protobuf — Algoriddim-internal.

### Layout

```
TSAF <2 bytes version> <2 bytes version>    ; header
<uint32 value-count> <uint32 ?>              ; record header (little-endian)
<class-marker>
<field0-value> <field0-key-tag>
<field1-value> <field1-key-tag>
...
```

A **class marker** is the tag byte `0x2B` followed by `0x08 <ascii-class-name> 0x00`
(e.g. `ADCHistorySessionItem`, `ADCMediaItemLocation`).

Each field is emitted **value-first**, then its tagged name:

```
<value bytes> <0x08 key-ascii 0x00>
```

### Value tags

| Tag | Type | Encoding |
|---|---|---|
| `0x08` | UTF-8 string | `0x08 <utf8 bytes> 0x00` |
| `0x14` | IEEE-754 double | 8 bytes little-endian directly preceding the next key tag |
| `0x30` | Date | Same 8 bytes as `0x14`, interpreted as **CFAbsoluteTime** (seconds since 2001-01-01 UTC) |
| `0x0B` | Object reference | `0x0B 0x01 0x00 0x00 0x00` (5 bytes) — introduces a nested object |
| `0x05` | Short reference | `0x05 <1 byte index>` (2 bytes) — reference-table index |
| `0x2B` | Class name | `0x2B 0x08 <ascii-class-name> 0x00` |

For doubles and dates, the parser can read the 8 bytes **immediately preceding**
the next `0x08` key-tag — no need to track the leading `0x14`/`0x30` tag or any
padding. This is how `src/tsaf.ts` extracts `duration`, `deckNumber`,
`startTime`, etc.

### Example: a `historySessionItems` record

```
54 53 41 46 03 00 03 00                      ; TSAF magic + version
03 00 00 00 00 00 00 00                      ; (record header)
11 00 00 00                                  ; 17 fields (uint32 LE)
2B 08 'ADCHistorySessionItem' 00              ; class marker
08 '<item-uuid>' 00 08 'uuid' 00              ; field 1: uuid
08 '<session-uuid>' 00 08 'sessionUUID' 00    ; field 2: sessionUUID
2B 08 'ADCMediaItemTitleID' 00                ; nested class
  08 '<title-id-hex>' 00                       ;   nested uuid
  05 01                                        ;   ref marker
  05 02                                        ;   ref marker
  08 '<title>' 00 08 'title' 00                ;   title
  08 '<artist>' 00 08 'artist' 00              ;   artist
  14 <8 bytes LE double> 08 'duration' 00      ;   duration (s)
  00                                           ;
  08 'titleID' 00                              ; nested end marker
14 <8 bytes LE double> 08 'deckNumber' 00     ; deckNumber (1.0/2.0/...)
30 <8 bytes LE CFAbsoluteTime> 08 'startTime' 00
08 'explorer' 00 08 'originSourceID' 00       ; originSourceID
...
```

## .djayMetadata structure

`.djayMetadata` is an **Apple binary plist** (`bplist00` magic) — readable
directly with Python's `plistlib` or any bplist library. One file per titleID,
stored under `Metadata/<first-2-hex>/`.

Top-level keys:

| Key | Purpose |
|---|---|
| `info` | Basic track metadata (mirrors the DB) |
| `timestampInfo` | Staleness tracking |
| `keyInfo` | Musical key analysis |
| `waveInfoCompact` | Overview waveform (mono envelope) |
| `newGainInfo` | Auto-gain / loudness normalization |
| `deepBeatTrackerInfo` | AI-generated beatgrid + per-frame transient data |
| `waveColorsInfo` | Color-coded waveform for display |

### `info`

| Key | Type | Notes |
|---|---|---|
| `Name` | str | Title |
| `Artist` | str | |
| `Duration` | int | Seconds |
| `source` | int | Source flag (1 = ?) |

### `keyInfo`

| Key | Type | Notes |
|---|---|---|
| `keyIndex` | int | djay's internal key index — 0..23, covers major + minor across 12 semitones |
| `secondKeyIndex` | int | Second-most-likely key |
| `keyConfidence` | float | 0..1 confidence for `keyIndex` |
| `keyReferenceTuning` | float | Detected tuning in Hz — interestingly not 440 Hz in the test track (442.54 Hz) |
| `version` | int | Analysis model version |

### `waveInfoCompact`

| Key | Type | Notes |
|---|---|---|
| `lowRateTotalNumSamples` | int | Number of overview samples (4096 for a 5-minute track) |
| `lowRateWaveFinalSampleRate` | float | Samples per second (≈13.3 Hz → ~75 ms per sample) |
| `lowRateWavePeak` | float | Peak value (may be >1.0 before normalization) |
| `lowRateWaveSamplesAreNormalized` | int | 1 if samples are normalized to peak |
| `compressedLowRateWaveSamples` | bytes | **zlib-compressed uint8 samples.** Decompress with `zlib.decompress()`; one byte per sample in 0..255. Verified against a 5-minute track: 3372 → 4096 bytes. |
| `compressedLowRateWaveSamplesMax` | bytes | zlib-compressed running-max overlay used by djay's waveform renderer |
| `version` | int | |

### `newGainInfo`

| Key | Type | Notes |
|---|---|---|
| `AutoTitleGain` | float | dB gain to apply (negative = attenuate) — e.g. `-8.66` |
| `AutoTitleGainLoudnessRange` | float | LRA in LU |
| `isiOSOptimized` | int | |
| `version` | int | |

### `deepBeatTrackerInfo`

The star of the show. Output of Algoriddim's deep-learning beat tracker.

| Key | Type | Notes |
|---|---|---|
| `deepBeatTrackerModelName` | str | Model identifier — observed: `ARDeepBeatTrackerModel1011_9` |
| `bpm` | float | Final detected BPM |
| `analyzedBPM` | float | Pre-straightening BPM estimate |
| `straightBPM` | float | Fixed-BPM grid value |
| `straightGrid` | int | 1 if the track has a single fixed BPM |
| `hasStraightSegment` | int | |
| `straightGridDistance` | float | Distance from the detected grid to the nearest multiple of `straightBPM` |
| `forcedStraightGrid` | int | 1 if the user manually forced straight grid |
| `bpmConfidence` | float | 0..1 |
| `timeSignatureIndex` | int | Enum — `4` is 4/4 time |
| `firstDownBeatIndex` | int | Index into `compressedBeats` of the first detected downbeat |
| `alternateFirstDownBeatIndex` | int | Alternative downbeat interpretation |
| `transientActivationFPS` | float | Frame rate of the ML model's activation output (≈105 FPS observed) |
| `compressedBeats` | bytes | **zlib-compressed big-endian float32 array of beat times in seconds.** Not little-endian — despite running on x86. Decompress, then read 4 bytes at a time as `>f`. Verified: 893 beats for a 308s / 174 BPM track, average interval 0.345 s = 60/174. |
| `compressedAlternateBeats` | bytes | Same encoding — alternative beat interpretation |
| `compressedBPMChangeTimes` | bytes | zlib-compressed float32 array of timestamps where BPM changes |
| `compressedPrevalentBPMs` | bytes | zlib-compressed — dominant BPMs over time |
| `compressedTransientPositions` | bytes | zlib-compressed float32 array — detected transient positions |
| `compressedTransientEnergies` | bytes | zlib-compressed — transient energies |
| `compressedTransientActivation` | bytes | zlib-compressed raw activation stream from the ML model (~114 KB for a 5-min track) |
| `compressedTimestampIdentifier` | bytes | zlib-compressed — purpose unclear |
| `timestampInfoVersion` | int | |
| `version` | int | Model/output format version |

### `waveColorsInfo`

Per-sample color data used to render djay Pro's colored waveform bar. Stored at
two resolutions so the renderer can use the lower rate when zoomed out.

| Key | Type | Notes |
|---|---|---|
| `lowRateSampleRate` | float | ≈3.4 Hz |
| `lowRateWaveTotalNumColors` | int | Number of samples at low rate |
| `compressedLowRateWaveColors` | bytes | zlib-compressed color samples |
| `normalRateSampleRate` | float | ≈172 Hz |
| `normalRateTotalNumSamplesColors` | int | Number of samples at normal rate |
| `normalRateWaveSamplesColors` | bytes | Color samples at normal rate (**note:** not zlib-compressed in the observed file — the raw byte count matches the sample count × bytes per color) |
| `version` | int | |

## Integration notes for `djay-connect`

The minimum data needed for now-playing is already extracted from
`historySessionItems` alone — title, artist, duration, deck number, start time.
This is what the `DjayConnect` class emits today.

Fields we could surface additionally without opening a second file:

- `originSourceID` — maps directly to `RawTrack.streamingSource` for streaming
  tracks and gives us a way to distinguish `explorer` vs `music` for local
  files.
- `isrc` — streaming tracks carry ISRCs in the history item; useful for
  third-party track lookups.

Fields that require joining `localMediaItemLocations` / `globalMediaItemLocations`
by `titleID`:

- Local file path (for artwork resolution or file fingerprinting)
- Streaming URI (for deep-linking back to the source service)
- The multi-URI case (a track available on both SoundCloud and Beatport)

Fields that require reading `.djayMetadata`:

- BPM + musical key (also in `mediaItemAnalyzedData` but less precise)
- Auto-gain
- Waveform samples
- Beatgrid

## Key index mapping (djay Pro)

djay Pro uses a 0..23 internal key index. The exact mapping is an educated
guess from the 12 semitones × (major, minor) pairing; the Voodoo People test
track has `keyIndex=23`, `secondKeyIndex=16`. Beatport's Camelot data for the
same track says **G Minor / Camelot 6A**, so this mapping can be back-solved
when we need it.

## Known unknowns

- Exact semantics of the `type` field in `*MediaItemLocations` (observed `1.0`)
- Exact semantics of the TSAF `0x05` short-reference and `0x0B` object-reference tags beyond "this is a nested object"
- Format of `compressedTransientActivation` — likely the raw float activation
  stream from the beat-tracker model, ~105 samples per second
- Content and format of the `Beatport/__guest/tr/<id>.trk` cached track files
  (1.4 MB of apparently encrypted data per Beatport track — presumably the
  audio preview in a proprietary container)
- What's inside `LocalCache/Local/Algoriddim/djay/Preferences/.lck` (directory,
  probably lock files)
- Whether the `settings.dat` UWP LocalSettings file holds anything not in the
  Algoriddim preferences plist

## Version notes

All of the above was captured from a live session running **djay Pro for
Windows 5.6.4** (installed via the Microsoft Store, package family name
`59BEBC1A.djay_e3tqh12mt5rj6`). djay Pro ships on a brisk release cadence, so
future major versions may rename fields, bump blob encodings, or restructure
the `.djayMetadata` plist. Re-run the exploration scripts (see `scripts/` at
the time of research) against a fresh snapshot if anything stops matching.
