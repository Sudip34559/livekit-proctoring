import { useEffect } from "react";
import type { DetectionConfig, IncidentType, SpeechRecognition } from "./types";
import { getCooldownMs, sensitivityToThreshold } from "./config";
import { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
  mediaStream: MediaStream | null;
  config: DetectionConfig;
  getCooldowns: () => CooldownManager;

  fire: (
    type: IncidentType,
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
}

// Extend Window safely
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useNoiseDetector({
  enabled,
  mediaStream,
  config,
  getCooldowns,
  fire,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs, sensitivity } =
    config;

  const cooldowns = getCooldowns();

  // ── Background noise ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.backgroundNoiseDetected.enabled) return;
    if (!mediaStream) return;

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let animId: number | null = null;
    let micStream: MediaStream | null = null;
    let isMounted = true;

    const noiseCd = getCooldownMs(
      "background_noise_detected",
      incidentCooldowns,
      cooldownMs,
    );
    const threshold = sensitivityToThreshold(sensitivity);

    const run = async () => {
      try {
        const activeTrack = mediaStream
          .getAudioTracks()
          .find((t) => t.readyState === "live" && t.enabled);

        micStream = activeTrack
          ? new MediaStream([activeTrack.clone()])
          : await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            });

        if (!micStream.getAudioTracks().length) return;

        audioCtx = new AudioContext();
        if (audioCtx.state === "suspended") await audioCtx.resume();

        source = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);

        const timeDomain = new Uint8Array(analyser.fftSize);
        const freqDomain = new Uint8Array(analyser.frequencyBinCount);

        const rmsBuffer: number[] = [];
        const spectralBuffer: number[] = [];

        let baselineRms = 0;
        let baselineSpectral = 0;
        let baselineReady = false;
        let consecutiveLoud = 0;
        let isLoudState = false;
        let baselineFreezeUntil = 0;
        let lastTrigger = 0;

        const detect = () => {
          if (!isMounted) return;

          analyser.getByteTimeDomainData(timeDomain);
          analyser.getByteFrequencyData(freqDomain);

          let sum = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const v = (timeDomain[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeDomain.length);

          let fsum = 0;
          for (let i = 0; i < freqDomain.length; i++) {
            fsum += freqDomain[i];
          }
          const spectral = fsum / (freqDomain.length * 255);

          rmsBuffer.push(rms);
          if (rmsBuffer.length > 10) rmsBuffer.shift();

          spectralBuffer.push(spectral);
          if (spectralBuffer.length > 10) spectralBuffer.shift();

          const avgRms =
            rmsBuffer.reduce((a, b) => a + b, 0) / rmsBuffer.length;

          const avgSpectral =
            spectralBuffer.reduce((a, b) => a + b, 0) / spectralBuffer.length;

          if (!baselineReady) {
            baselineRms = avgRms;
            baselineSpectral = avgSpectral;
            baselineReady = true;
          }

          const rmsEnter = Math.max(threshold, baselineRms * 1.8 + 0.003);
          const rmsExit = Math.max(
            threshold * 0.85,
            baselineRms * 1.45 + 0.0015,
          );

          const spectralEnter = Math.max(0.06, baselineSpectral * 1.6 + 0.02);
          const spectralExit = Math.max(0.05, baselineSpectral * 1.35 + 0.015);

          const rmsLoud = isLoudState ? avgRms > rmsExit : avgRms > rmsEnter;

          const spectralLoud = isLoudState
            ? avgSpectral > spectralExit
            : avgSpectral > spectralEnter;

          const isLoud = rmsLoud || spectralLoud;
          isLoudState = isLoud;

          const now = Date.now();

          if (!isLoud && now >= baselineFreezeUntil) {
            baselineRms = baselineRms * 0.98 + avgRms * 0.02;
            baselineSpectral = baselineSpectral * 0.98 + avgSpectral * 0.02;
          }

          const variance =
            rmsBuffer.reduce((s, v) => s + (v - avgRms) ** 2, 0) /
            rmsBuffer.length;

          const isSpeechLike = variance > 0.001;

          consecutiveLoud = isLoud ? consecutiveLoud + 1 : 0;

          if (
            consecutiveLoud >= 3 &&
            !isSpeechLike &&
            now - lastTrigger > noiseCd &&
            cooldowns.tryFire("background_noise_detected", noiseCd)
          ) {
            lastTrigger = now;
            baselineFreezeUntil = now + 15_000;

            fire("background_noise_detected", "Background noise detected", {
              rms: avgRms,
              spectral: avgSpectral,
            });
          }

          animId = requestAnimationFrame(detect);
        };

        detect();
      } catch (err) {
        console.error("[NoiseDetector] init failed:", err);
      }
    };

    run();

    return () => {
      isMounted = false;
      if (animId !== null) cancelAnimationFrame(animId);
      source?.disconnect();
      audioCtx?.close().catch(() => {});
      micStream?.getTracks().forEach((t) => t.stop());
    };
  }, [
    enabled,
    mediaStream,
    incidentSettings.backgroundNoiseDetected.enabled,
    incidentCooldowns,
    cooldownMs,
    sensitivity,
    cooldowns,
    fire,
  ]);

  // ── Speech detection ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.speechDetected.enabled) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) return;

    const speechCd = getCooldownMs(
      "speech_detected",
      incidentCooldowns,
      cooldownMs,
    );

    const recognition = new SR();
    let active = true;
    let lastSpeech = 0;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onend = () => {
      if (active) setTimeout(() => recognition.start(), 1000);
    };

    recognition.onresult = function (this: SpeechRecognition, e) {
      const now = Date.now();

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript.trim();

        if (
          result.isFinal &&
          now - lastSpeech > 1000 &&
          cooldowns.tryFire("speech_detected", speechCd)
        ) {
          lastSpeech = now;
          fire("speech_detected", "Speech detected", { transcript });
        }
      }
    };

    recognition.start();

    return () => {
      active = false;
      recognition.stop();
    };
  }, [
    cooldownMs,
    cooldowns,
    enabled,
    fire,
    incidentCooldowns,
    incidentSettings.speechDetected.enabled,
  ]);

  // ── Microphone disabled ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !incidentSettings.microphoneDisabled.enabled) return;

    const micCd = getCooldownMs(
      "microphone_disabled",
      incidentCooldowns,
      cooldownMs,
    );

    const check = () => {
      if (!mediaStream) {
        if (cooldowns.tryFire("microphone_disabled", micCd)) {
          fire("microphone_disabled", "Microphone stream is missing");
        }
        return;
      }

      const live = mediaStream
        .getAudioTracks()
        .find((t) => t.readyState === "live" && t.enabled);

      if (!live) {
        if (cooldowns.tryFire("microphone_disabled", micCd)) {
          fire("microphone_disabled", "Microphone track is disabled or ended");
        }
      }
    };

    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [
    enabled,
    mediaStream,
    incidentSettings.microphoneDisabled.enabled,
    incidentCooldowns,
    cooldownMs,
    cooldowns,
    fire,
  ]);
}
