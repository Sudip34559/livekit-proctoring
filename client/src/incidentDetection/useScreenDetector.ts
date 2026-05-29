import { useEffect, useRef } from "react";
import type { DetectionConfig, IncidentType } from "./types";
import { getCooldownMs } from "./config";
import { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
  screenStream: MediaStream | null;
  config: DetectionConfig;
  getCooldowns: () => CooldownManager;
  fire: (
    type: IncidentType,
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
}

/**
 * Detects:
 *  - screen_not_shared       (screen-share stream missing or track ended)
 *  - second_screen_connected (Screen Details API / window.screen.isExtended)
 *  - exited_the_full_screen  (fullscreen API + F11/Escape key backup)
 */
export function useScreenDetector({
  enabled,
  screenStream,
  config,
  getCooldowns,
  fire,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const initialDimsRef = useRef({ width: 0, height: 0 });
  const screenCountRef = useRef(1);
  const cooldowns = getCooldowns();

  // ── Screen share monitoring ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.screenNotShared.enabled) return;

    const shareCd = getCooldownMs(
      "screen_not_shared",
      incidentCooldowns,
      cooldownMs,
    );

    const check = () => {
      if (!screenStream) {
        if (cooldowns.tryFire("screen_not_shared", shareCd))
          fire("screen_not_shared", "Screen sharing is not active");
        return;
      }
      const tracks = screenStream.getVideoTracks();
      if (!tracks.length || tracks[0].readyState === "ended") {
        if (cooldowns.tryFire("screen_not_shared", shareCd))
          fire("screen_not_shared", "Screen share track ended");
      }
    };

    // React to track-end events immediately
    const tracks = screenStream?.getVideoTracks() ?? [];
    const onEnded = () => {
      if (cooldowns.tryFire("screen_not_shared", shareCd))
        fire("screen_not_shared", "Screen share track ended (track event)");
    };
    tracks.forEach((t) => t.addEventListener("ended", onEnded));

    check();
    const id = setInterval(check, 5_000);

    return () => {
      clearInterval(id);
      tracks.forEach((t) => t.removeEventListener("ended", onEnded));
    };
  }, [
    enabled,
    screenStream,
    incidentSettings.screenNotShared.enabled,
    incidentCooldowns,
    cooldownMs,
    cooldowns,
    fire,
  ]);

  // ── Multi-screen detection ─────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.secondScreenConnected.enabled) return;

    const multiCd = getCooldownMs(
      "second_screen_connected",
      incidentCooldowns,
      cooldownMs,
    );

    const detectScreenCount = async (): Promise<number> => {
      // Method 1: Screen.isExtended (Chrome ≥ 111)
      if ("isExtended" in window.screen) {
        if ((window.screen as { isExtended?: boolean }).isExtended) return 2;
      }
      // Method 2: getScreenDetails API
      if ("getScreenDetails" in window) {
        try {
          const details = await (
            window as {
              getScreenDetails: () => Promise<{ screens: unknown[] }>;
            }
          ).getScreenDetails();
          return details.screens.length;
        } catch {
          /* empty */
        }
      }
      // Method 3: Stored value from equipment check
      const stored = localStorage.getItem("displayCount");
      if (stored) return parseInt(stored, 10);
      return 1;
    };

    const check = async () => {
      const count = await detectScreenCount();

      // Dimension drift check
      const sw = window.screen.width;
      const sh = window.screen.height;
      if (initialDimsRef.current.width === 0) {
        initialDimsRef.current = { width: sw, height: sh };
      } else {
        const dw = Math.abs(sw - initialDimsRef.current.width);
        const dh = Math.abs(sh - initialDimsRef.current.height);
        if (dw > 100 || dh > 100) {
          initialDimsRef.current = { width: sw, height: sh };
          if (cooldowns.tryFire("second_screen_connected", multiCd))
            fire(
              "second_screen_connected",
              "Significant screen dimension change – possible new display",
              { screenCount: count },
            );
          return;
        }
      }

      if (count > 1 && cooldowns.tryFire("second_screen_connected", multiCd)) {
        screenCountRef.current = count;
        localStorage.setItem("displayCount", String(count));
        fire(
          "second_screen_connected",
          `Second screen detected (${count} screens)`,
          { screenCount: count },
        );
      }
    };

    // Initial check
    detectScreenCount().then((c) => {
      screenCountRef.current = c;
      initialDimsRef.current = {
        width: window.screen.width,
        height: window.screen.height,
      };
    });

    // Re-check every 4.8 s (slightly less than the 5 s cooldown to keep incidents alive)
    const id = setInterval(check, 4_800);

    // Listen for screenschange event if available
    const onScreensChange = () => check();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.screen as any)?.addEventListener?.("change", onScreensChange);

    return () => {
      clearInterval(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.screen as any)?.removeEventListener?.("change", onScreensChange);
    };
  }, [
    cooldownMs,
    cooldowns,
    enabled,
    fire,
    incidentCooldowns,
    incidentSettings.secondScreenConnected.enabled,
  ]);

  // ── Fullscreen monitoring ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.exitedTheFullScreen.enabled) return;

    const fsCd = getCooldownMs(
      "exited_the_full_screen",
      incidentCooldowns,
      cooldownMs,
    );

    const isFs = () =>
      !!(
        document.fullscreenElement ||
        (document as { webkitFullscreenElement?: Element })
          .webkitFullscreenElement ||
        (document as { mozFullScreenElement?: Element }).mozFullScreenElement
      );

    let wasFs = isFs();

    const tryFireExit = (msg: string) => {
      if (cooldowns.tryFire("exited_the_full_screen", fsCd))
        fire("exited_the_full_screen", msg);
    };

    const onFsChange = () => {
      const now = isFs();
      if (wasFs && !now)
        tryFireExit("Fullscreen exited (fullscreenchange event)");
      wasFs = now;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F11" || e.key === "Escape") {
        setTimeout(() => {
          const now = isFs();
          if (wasFs && !now) tryFireExit(`Fullscreen exited via ${e.key}`);
          wasFs = now;
        }, 150);
      }
    };

    // Periodic drift guard
    const id = setInterval(() => {
      const now = isFs();
      if (wasFs && !now)
        tryFireExit("Fullscreen exit detected by periodic check");
      wasFs = now;
    }, 2_000);

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("mozfullscreenchange", onFsChange);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      clearInterval(id);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      document.removeEventListener("mozfullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [
    cooldownMs,
    cooldowns,
    enabled,
    fire,
    incidentCooldowns,
    incidentSettings.exitedTheFullScreen.enabled,
  ]);
}
