// Auto-show ("attract mode") sequencing for the projection card. Pure timing +
// selection logic; the canvas calls update() every frame with the set of
// currently-shown aircraft and renders whatever it returns.
//
// Behaviour:
//   - Cycle: pick a random shown aircraft → display 5s → hide → 3s gap → repeat.
//   - New aircraft: when a small batch (1–4) of new aircraft appears, queue them
//     so each is shown next (a large influx is ignored to avoid a spam burst).

const SHOW_MS = 5000;
const GAP_MS = 3000;
const NEW_BATCH_MAX = 5; // show all new only when fewer than this appear at once

export interface ShowcaseState {
  hex: string | null; // currently featured aircraft (null while hidden)
  visible: boolean;
}

export class ShowcaseController {
  private known = new Set<string>();
  private initialized = false;
  private queue: string[] = [];
  private currentHex: string | null = null;
  private visible = false;
  private phaseUntil = 0;
  private lastPick: string | null = null;

  update(visibleHexes: string[], now: number, enabled: boolean): ShowcaseState {
    if (!enabled) {
      this.reset();
      return { hex: null, visible: false };
    }

    const visset = new Set(visibleHexes);
    this.trackNew(visibleHexes, visset);

    if (this.phaseUntil === 0) {
      this.advance(visibleHexes, now); // first run
    } else if (now >= this.phaseUntil) {
      if (this.visible) {
        this.visible = false;
        this.currentHex = null;
        this.phaseUntil = now + GAP_MS;
      } else {
        this.advance(visibleHexes, now);
      }
    }

    // Featured aircraft left the view mid-show: end early into the gap.
    if (this.visible && this.currentHex && !visset.has(this.currentHex)) {
      this.visible = false;
      this.currentHex = null;
      this.phaseUntil = now + GAP_MS;
    }

    return { hex: this.currentHex, visible: this.visible };
  }

  private trackNew(visibleHexes: string[], visset: Set<string>): void {
    if (!this.initialized) {
      for (const h of visibleHexes) this.known.add(h);
      this.initialized = true;
      return;
    }
    const fresh: string[] = [];
    for (const h of visibleHexes) {
      if (!this.known.has(h)) fresh.push(h);
      this.known.add(h);
    }
    // Forget aircraft that left, so they can be featured again if they return.
    for (const h of [...this.known]) if (!visset.has(h)) this.known.delete(h);

    if (fresh.length > 0 && fresh.length < NEW_BATCH_MAX) {
      for (const h of fresh) if (!this.queue.includes(h)) this.queue.push(h);
    }
  }

  private advance(visibleHexes: string[], now: number): void {
    const pick = this.pick(visibleHexes);
    if (!pick) {
      this.visible = false;
      this.currentHex = null;
      this.phaseUntil = now + GAP_MS; // nothing to show yet; retry after a gap
      return;
    }
    this.currentHex = pick;
    this.lastPick = pick;
    this.visible = true;
    this.phaseUntil = now + SHOW_MS;
  }

  private pick(visibleHexes: string[]): string | null {
    // Newly-discovered aircraft jump the line.
    while (this.queue.length) {
      const h = this.queue.shift()!;
      if (visibleHexes.includes(h)) return h;
    }
    if (visibleHexes.length === 0) return null;
    if (visibleHexes.length === 1) return visibleHexes[0];
    let h = this.lastPick;
    for (let i = 0; i < 6 && h === this.lastPick; i++) {
      h = visibleHexes[Math.floor(Math.random() * visibleHexes.length)];
    }
    return h;
  }

  private reset(): void {
    this.known.clear();
    this.initialized = false;
    this.queue = [];
    this.currentHex = null;
    this.visible = false;
    this.phaseUntil = 0;
    this.lastPick = null;
  }
}
