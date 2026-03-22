/**
 * @fileoverview DjayConnect - Event-based djay Pro NowPlaying.txt reader.
 * Monitors djay Pro's NowPlaying.txt file and emits events when tracks change.
 */

import EventEmitter from 'node:events';
import { existsSync, readFileSync } from 'fs';
import { type Logger, noopLogger } from './types/logger.js';
import { getDefaultNowPlayingPath } from './detect.js';
import type { DjayConnectOptions, DjayNowPlayingTrack, TypedEmitter } from './types.js';

const MIN_POLL_INTERVAL = 5000;
const DEFAULT_POLL_INTERVAL = 5000;

/**
 * DjayConnect monitors djay Pro's NowPlaying.txt file and emits events
 * when the currently playing track changes.
 */
export class DjayConnect extends (EventEmitter as new () => TypedEmitter) {
  private pollIntervalMs: number;
  private nowPlayingPath: string;
  private logger: Logger;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTrackId: string | null = null;
  private isRunning: boolean = false;

  constructor(options: DjayConnectOptions = {}) {
    super();
    this.logger = options.logger ?? noopLogger;
    this.nowPlayingPath = options.nowPlayingPath ?? getDefaultNowPlayingPath();
    this.pollIntervalMs = Math.max(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL,
      MIN_POLL_INTERVAL
    );
  }

  /**
   * Start monitoring the NowPlaying.txt file.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.debug(`Starting, watching: ${this.nowPlayingPath}`);

    if (!existsSync(this.nowPlayingPath)) {
      this.logger.warn(`NowPlaying.txt not found at: ${this.nowPlayingPath}`);
    }

    // Read initial track state
    const currentTrack = this.parseNowPlayingTxt();
    if (currentTrack && (currentTrack.title || currentTrack.artist)) {
      this.lastTrackId = this.getTrackId(currentTrack);
      this.logger.debug(`Initial track: ${currentTrack.artist} - ${currentTrack.title}`);
      this.emit('track', { track: currentTrack });
    }

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);

    this.logger.info(`Watching djay Pro NowPlaying.txt (poll interval: ${this.pollIntervalMs}ms)`);
    this.emit('ready', { nowPlayingPath: this.nowPlayingPath });
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.lastTrackId = null;
    this.isRunning = false;
    this.logger.debug('Stopped');
  }

  /**
   * Check if currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Set the polling interval. Takes effect immediately if running.
   */
  setPollInterval(intervalMs: number): void {
    this.pollIntervalMs = Math.max(intervalMs, MIN_POLL_INTERVAL);

    if (this.isRunning && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    }
  }

  /**
   * Get the current polling interval.
   */
  get pollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Get the path being monitored.
   */
  get path(): string {
    return this.nowPlayingPath;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Poll for track changes.
   */
  private poll(): void {
    try {
      this.emit('poll');

      const track = this.parseNowPlayingTxt();

      if (!track || (!track.title && !track.artist)) {
        return;
      }

      const trackId = this.getTrackId(track);

      if (trackId === this.lastTrackId) {
        return;
      }

      this.lastTrackId = trackId;

      this.logger.debug(`New track: ${track.artist} - ${track.title}`);
      this.emit('track', { track });
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Parse the NowPlaying.txt file.
   */
  private parseNowPlayingTxt(): DjayNowPlayingTrack | null {
    if (!existsSync(this.nowPlayingPath)) {
      return null;
    }

    try {
      const contents = readFileSync(this.nowPlayingPath, { encoding: 'utf-8' });
      const lines = contents.split('\n');

      if (lines.length < 4) {
        return null;
      }

      return {
        title: lines[0]?.replace('Title: ', '') || '',
        artist: lines[1]?.replace('Artist: ', '') || '',
        album: lines[2]?.replace('Album: ', '') || '',
        time: lines[3]?.replace('Time: ', '') || '',
      };
    } catch (error) {
      this.logger.error('Failed to parse NowPlaying.txt:', error);
      return null;
    }
  }

  /**
   * Create a unique ID for a track to detect changes.
   */
  private getTrackId(track: DjayNowPlayingTrack): string {
    return `${track.title}${track.artist}${track.time}${track.album}`;
  }
}
