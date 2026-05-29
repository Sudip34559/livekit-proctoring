import { useEffect } from "react";
import type { DetectionConfig, IncidentType } from "./types";
import { getCooldownMs } from "./config";
import { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
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
 *  - Tab switch / window hide  (window_changed)
 *  - Window blur               (window_changed)
 *  - Mouse leaving viewport    (window_changed, 5 s delay)
 *  - Fullscreen exit           (exited_the_full_screen)
 *  - DevTools key shortcuts    (window_changed)
 *  - Context-menu              (suppressed)
 *  - Focus polling backup      (500 ms)
 */
export function useWindowFocusDetector({
  enabled,
  config,
  getCooldowns,
  fire,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const cooldowns = getCooldowns();
  useEffect(() => {
    if (!enabled) return;
    if (
      !incidentSettings.windowChanged.enabled &&
      !incidentSettings.exitedTheFullScreen.enabled
    )
      return;

    // ── helpers ───────────────────────────────────────────────────────────────
    const windowCd = getCooldownMs(
      "window_changed",
      incidentCooldowns,
      cooldownMs,
    );
    const fullscreenCd = getCooldownMs(
      "exited_the_full_screen",
      incidentCooldowns,
      cooldownMs,
    );

    const tryWindowChanged = (msg: string) => {
      if (!incidentSettings.windowChanged.enabled) return;
      if (cooldowns.tryFire("window_changed", windowCd)) {
        fire("window_changed", msg);
      }
    };

    const tryFullscreenExit = (msg: string) => {
      if (!incidentSettings.exitedTheFullScreen.enabled) return;
      if (cooldowns.tryFire("exited_the_full_screen", fullscreenCd)) {
        fire("exited_the_full_screen", msg);
      }
    };

    const isFullscreen = () =>
      !!(
        document.fullscreenElement ||
        (document as { webkitFullscreenElement?: Element })
          .webkitFullscreenElement ||
        (document as { mozFullScreenElement?: Element }).mozFullScreenElement
      );

    let wasFullscreen = isFullscreen();
    let isWindowHidden = false;
    let isMouseInWindow = true;
    let mouseLeaveTimer: ReturnType<typeof setTimeout> | null = null;
    let windowHiddenTimer: ReturnType<typeof setInterval> | null = null;
    let focusPollingTimer: ReturnType<typeof setInterval> | null = null;
    let lastFocused = !document.hidden && document.hasFocus();

    // ── continuous monitoring while hidden ────────────────────────────────────
    const startHiddenMonitoring = (reason: string) => {
      if (isWindowHidden) return;
      isWindowHidden = true;
      tryWindowChanged(reason);

      const interval = Math.max(windowCd * 0.96, 1_000);
      windowHiddenTimer = setInterval(() => {
        if (document.hidden || !isMouseInWindow) {
          tryWindowChanged("Window still hidden – ongoing monitoring");
        } else {
          stopHiddenMonitoring();
        }
      }, interval);
    };

    const stopHiddenMonitoring = () => {
      if (!isWindowHidden) return;
      isWindowHidden = false;
      if (windowHiddenTimer) clearInterval(windowHiddenTimer);
      windowHiddenTimer = null;
    };

    // ── event handlers ────────────────────────────────────────────────────────
    const onVisibilityChange = () => {
      if (document.hidden && !isWindowHidden)
        startHiddenMonitoring("User switched tab or minimized window");
      else if (!document.hidden && isWindowHidden) stopHiddenMonitoring();
    };

    const onFocusChange = () => {
      const focused = document.hasFocus() && !document.hidden;
      if (!focused && !isWindowHidden)
        startHiddenMonitoring("Window lost focus");
      else if (focused && isWindowHidden) stopHiddenMonitoring();
    };

    const onMouseLeave = () => {
      isMouseInWindow = false;
      if (mouseLeaveTimer) clearTimeout(mouseLeaveTimer);
      mouseLeaveTimer = setTimeout(() => {
        startHiddenMonitoring("Mouse left viewport for >5 s");
        mouseLeaveTimer = null;
      }, 5_000);
    };

    const onMouseEnter = () => {
      isMouseInWindow = true;
      if (mouseLeaveTimer) {
        clearTimeout(mouseLeaveTimer);
        mouseLeaveTimer = null;
      }
      stopHiddenMonitoring();
    };

    const onFullscreenChange = () => {
      const now = isFullscreen();
      if (wasFullscreen && !now)
        tryFullscreenExit("User exited fullscreen mode");
      wasFullscreen = now;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Devtools / view-source shortcuts → treat as window_changed
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) ||
        (e.ctrlKey && e.key === "u") ||
        (e.ctrlKey && e.key === "s")
      ) {
        e.preventDefault();
        tryWindowChanged(`Devtools shortcut attempted: ${e.key}`);
      }

      // F11 fullscreen toggle
      if (e.key === "F11") {
        setTimeout(() => {
          const now = isFullscreen();
          if (wasFullscreen && !now)
            tryFullscreenExit("User pressed F11 to exit fullscreen");
          wasFullscreen = now;
        }, 150);
      }

      // Escape key
      if (e.key === "Escape") {
        setTimeout(() => {
          const now = isFullscreen();
          if (wasFullscreen && !now)
            tryFullscreenExit("User pressed Escape to exit fullscreen");
          wasFullscreen = now;
        }, 100);
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    // ── polling fallback (500 ms) ─────────────────────────────────────────────
    focusPollingTimer = setInterval(() => {
      const focused = document.hasFocus() && !document.hidden;
      if (focused === lastFocused) return;
      lastFocused = focused;
      if (!focused && !isWindowHidden)
        startHiddenMonitoring("Focus polling detected loss of focus");
      else if (focused && isWindowHidden) stopHiddenMonitoring();

      // Fullscreen drift check
      const now = isFullscreen();
      if (wasFullscreen && !now)
        tryFullscreenExit("Fullscreen exit detected by polling");
      wasFullscreen = now;
    }, 500);

    // ── register ──────────────────────────────────────────────────────────────
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onFocusChange);
    window.addEventListener("focus", onFocusChange);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    document.addEventListener("mozfullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("contextmenu", onContextMenu);

    // Initial check
    if (document.hidden) startHiddenMonitoring("Page loaded while hidden");

    return () => {
      stopHiddenMonitoring();
      if (mouseLeaveTimer) clearTimeout(mouseLeaveTimer);
      if (focusPollingTimer) clearInterval(focusPollingTimer);

      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onFocusChange);
      window.removeEventListener("focus", onFocusChange);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onFullscreenChange,
      );
      document.removeEventListener("mozfullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [
    enabled,
    config.enabled,
    incidentSettings.windowChanged.enabled,
    incidentSettings.exitedTheFullScreen.enabled,
    incidentCooldowns,
    cooldownMs,
    cooldowns,
    fire,
  ]);
}
