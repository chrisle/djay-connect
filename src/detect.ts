/**
 * @fileoverview Detection utilities for djay Pro installation.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Get the default path to djay Pro's NowPlaying.txt file.
 */
export function getDefaultNowPlayingPath(): string {
  return join(
    homedir(),
    'Music',
    'djay',
    'djay Media Library.djayMediaLibrary',
    'NowPlaying.txt'
  );
}

/**
 * Get the default djay Pro install/data path.
 */
export function getDefaultDjayInstallPath(): string {
  return join(homedir(), 'Music', 'djay');
}

/**
 * Detect if djay Pro is installed by checking for the djay folder.
 */
export function detectDjayInstallation(): { found: boolean; path: string } {
  const path = getDefaultDjayInstallPath();
  return {
    found: existsSync(path),
    path,
  };
}
