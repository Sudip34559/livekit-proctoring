import type { IncidentType } from "./types";

/**
 * Tracks the last-fired timestamp per incident type so every detector
 * can call `canFire` / `record` without duplicating state.
 */
export class CooldownManager {
  private last: Map<IncidentType, number> = new Map();

  canFire(type: IncidentType, cooldownMs: number): boolean {
    const prev = this.last.get(type) ?? 0;
    return Date.now() - prev >= cooldownMs;
  }

  record(type: IncidentType): void {
    this.last.set(type, Date.now());
  }

  /** Fire if cooldown has elapsed; returns true when the incident is allowed. */
  tryFire(type: IncidentType, cooldownMs: number): boolean {
    if (!this.canFire(type, cooldownMs)) return false;
    this.record(type);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}
