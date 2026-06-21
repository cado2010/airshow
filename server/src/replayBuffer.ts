import type { Aircraft } from "./types.js";

export interface Frame {
  at: number;
  aircraft: Aircraft[];
}

/**
 * Fixed-duration ring buffer of snapshots. Phase 1 wires this up so the
 * replay UI (Phase 5) has history to scrub; only live reads are used for now.
 */
export class ReplayBuffer {
  private frames: Frame[] = [];

  constructor(private readonly windowMs = 15 * 60 * 1000) {}

  push(frame: Frame): void {
    this.frames.push(frame);
    const cutoff = frame.at - this.windowMs;
    while (this.frames.length > 0 && this.frames[0].at < cutoff) {
      this.frames.shift();
    }
  }

  get span(): { from: number; to: number; count: number } {
    const count = this.frames.length;
    return {
      from: count ? this.frames[0].at : 0,
      to: count ? this.frames[count - 1].at : 0,
      count,
    };
  }
}
