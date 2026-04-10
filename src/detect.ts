/**
 * @fileoverview Detection utilities for djay Pro installation and database path.
 *
 * djay Pro stores its entire library (including a running history of played
 * tracks) in a YapDatabase-backed SQLite file named `MediaLibrary.db`. The
 * folder that contains it is named differently on macOS and Windows:
 *
 *   macOS:   ~/Music/djay/djay Media Library.djayMediaLibrary/MediaLibrary.db
 *   Windows: %USERPROFILE%\Music\djay\djay Media Library\MediaLibrary.db
 *
 * Both paths sit under `~/Music/djay`, which is what we return as the install
 * path for presence detection.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DJAY_ROOT_FOLDER = 'djay';
const DATABASE_FILE = 'MediaLibrary.db';
const DARWIN_LIBRARY_FOLDER = 'djay Media Library.djayMediaLibrary';
const WIN32_LIBRARY_FOLDER = 'djay Media Library';

/** Top-level djay Pro data folder (`~/Music/djay`). */
export function getDefaultDjayInstallPath(): string {
  return join(homedir(), 'Music', DJAY_ROOT_FOLDER);
}

/** Candidate MediaLibrary.db paths, in priority order for the current platform. */
export function getDefaultDatabasePaths(): string[] {
  const root = getDefaultDjayInstallPath();
  if (process.platform === 'darwin') {
    return [join(root, DARWIN_LIBRARY_FOLDER, DATABASE_FILE)];
  }
  if (process.platform === 'win32') {
    return [join(root, WIN32_LIBRARY_FOLDER, DATABASE_FILE)];
  }
  return [];
}

/** Resolve the MediaLibrary.db path for the current platform, picking the first that exists. */
export function getDefaultDatabasePath(): string {
  const candidates = getDefaultDatabasePaths();
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? '';
}

/** Detect if djay Pro is installed by checking for the djay data folder. */
export function detectDjayInstallation(): { found: boolean; path: string } {
  const path = getDefaultDjayInstallPath();
  return {
    found: existsSync(path),
    path,
  };
}
