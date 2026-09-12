/**
 * Real `mediaItemTitleIDs` BLOBs captured from djay Pro for macOS. A history
 * item's titleID is the row key here, and this record carries the `title` /
 * `artist` strings djay shows for the file.
 *
 *   - satisfaction — an untagged file added via My Files: title only (the
 *     file name), no artist key at all
 *   - Cotton Eye Joe (TRIODE Remix) — Rednex — a tagged file: title + artist
 */

export interface MediaItemTitleFixture {
  key: string;
  hex: string;
  expected: {
    title: string;
    artist: string;
  };
}

export const MEDIA_ITEM_TITLE_FIXTURES: MediaItemTitleFixture[] = [
  {
    key: '0e64b1accf11337d40ca05b1800d64f3',
    hex:
      '54534146030003000100000000000000060000002B084144434D656469614974' +
      '656D5469746C6549440008306536346231616363663131333337643430636130' +
      '35623138303064363466330008757569640008736174697366616374696F6E00' +
      '087469746C650013D9541A42086475726174696F6E0000',
    expected: {
      title: 'satisfaction',
      artist: '',
    },
  },
  {
    key: 'b3deef310ab4a4ad518f937cefe9d627',
    hex:
      '54534146030003000100000000000000080000002B084144434D656469614974' +
      '656D5469746C6549440008623364656566333130616234613461643531386639' +
      '33376365666539643632370008757569640008436F74746F6E20457965204A6F' +
      '6520285452494F44452052656D69782900087469746C6500085265646E657800' +
      '08617274697374001300000065210B43086475726174696F6E0000',
    expected: {
      title: 'Cotton Eye Joe (TRIODE Remix)',
      artist: 'Rednex',
    },
  },
];

export function mediaItemTitleBuffer(fixture: MediaItemTitleFixture): Buffer {
  return Buffer.from(fixture.hex.replace(/\s+/g, ''), 'hex');
}
