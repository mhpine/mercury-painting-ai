"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * ECI Adaptive Vision — Phase 1: observation only.
 *
 * IMPORTANT: This is an isolated laboratory route. It does not import or modify
 * MercuryCamera, LiveScan, photo processing, Supabase, or estimate calculations.
 * It never uploads a frame or modifies camera constraints after startup.
 */

type LightingReport = {
  brightness: number;
  shadowPercent: number;
  highlightPercent: number;
  contrast: number;
  colorCast: string;
  assessment: string;
  recommendation: string;
  sampledAt: number;
};

const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 54;
const SAMPLE_INTERVAL_MS = 1600;

function evaluateLighting(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): LightingReport {
  const count = width * height;
  let brightnessSum = 0;
  let darkPixels = 0;
  let blownPixels = 0;
  let neutralCount = 0;
  let warmBias = 0;
  let greenBias = 0;
  const histogram = new Uint32Array(256);

  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    const luma = Math.min(255, Math.max(0, Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue)));

    brightnessSum += luma;
    histogram[luma] += 1;
    if (luma < 45) darkPixels += 1;
    if (luma > 242) blownPixels += 1;

    // Only use moderately bright, near-neutral pixels as tentative color-cast
    // evidence. Strongly colored walls or objects must not be treated as a
    // confirmed tungsten / fluorescent source.
    const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (luma >= 65 && luma <= 215 && channelSpread <= 65) {
      neutralCount += 1;
      warmBias += red - blue;
      greenBias += green - (red + blue) / 2;
    }
  }

  const mean = brightnessSum / Math.max(1, count);
  const shadowPercent = (100 * darkPixels) / Math.max(1, count);
  const highlightPercent = (100 * blownPixels) / Math.max(1, count);

  const percentile = (fraction: number) => {
    const target = Math.max(1, Math.ceil(count * fraction));
    let seen = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      seen += histogram[value];
      if (seen >= target) return value;
    }
    return 255;
  };
  const contrast = percentile(0.95) - percentile(0.05);

  let colorCast = "Not enough neutral detail to assess";
  if (neutralCount >= count * 0.07) {
    const rb = warmBias / neutralCount;
    const g = greenBias / neutralCount;
    if (g > 13) colorCast = "Possible green cast";
    else if (rb > 17) colorCast = "Possible warm / yellow cast";
    else if (rb < -17) colorCast = "Possible cool / blue cast";
    else colorCast = "No strong cast detected";
  }

  let assessment = "Usable lighting";
  let recommendation = "Lighting looks reasonable for a photo. Verify fine surface defects visually.";
  if (mean < 58 || shadowPercent > 60) {
    assessment = "Low light — verify details";
    recommendation = "Add light or move to a brighter angle. Noise and shadows may hide small defects.";
  } else if (highlightPercent > 18) {
    assessment = "Bright areas may be clipped";
    recommendation = "Move away from direct glare or change angle before inspecting shiny or pale surfaces.";
  } else if (contrast > 190 && shadowPercent > 18 && highlightPercent > 4) {
    assessment = "High-contrast / mixed scene";
    recommendation = "Check both shadows and highlights; the camera may not preserve detail across the entire scene.";
  } else if (colorCast.startsWith("Possible")) {
    assessment = "Possible color cast";
    recommendation = "Colors may look different under this light. Confirm discoloration in neutral light.";
  }

  return {
    brightness: Math.round((mean / 255) * 100),
    shadowPercent: Math.round(shadowPercent),
    highlightPercent: Math.round(highlightPercent),
    contrast: Math.round((contrast / 255) * 100),
    colorCast,
    assessment,
    recommendation,
    sampledAt: Date.now(),
  };
}

export default function MercuryLightingLabPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startNumberRef = useRef(0);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<LightingReport | null>(null);

  const release = useCallback(() => {
    startNumberRef.current += 1;
    startingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStarting(false);
    setRunning(false);
    setReport(null);
  }, [release]);

  const start = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    const requestNumber = ++startNumberRef.current;
    setStarting(true);
    setError("");

    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("A secure HTTPS connection and camera permission are required.");
      }
      // Single request triggered by the user's tap; never auto-retry.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (requestNumber !== startNumberRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) throw new Error("Lighting Lab preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      if (requestNumber !== startNumberRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      setRunning(true);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (requestNumber === startNumberRef.current) {
        setError(cause instanceof Error ? cause.message : "Unable to start Lighting Lab camera.");
      }
    } finally {
      if (requestNumber === startNumberRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, []);

  // Use a tiny, private in-memory sample. Never change the video stream,
  // camera settings, original photo, or AI analysis; never upload frames.
  useEffect(() => {
    if (!running) return;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setError("The browser cannot sample a camera frame.");
      return;
    }

    const sample = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      if (document.visibilityState === "hidden") return;
      try {
        context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const frame = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        setReport(evaluateLighting(frame.data, SAMPLE_WIDTH, SAMPLE_HEIGHT));
      } catch {
        setError("Lighting measurement is unavailable on this device. LiveScan is unaffected.");
      }
    };

    sample();
    const intervalId = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [running]);

  useEffect(() => () => {
    // Never leave a test stream holding the phone camera when the user leaves.
    release();
  }, [release]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-7 text-white">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">ECI Adaptive Vision · Lab 1</p>
          <h1 className="text-3xl font-bold">Lighting Lab</h1>
          <p className="text-sm text-slate-300">
            Observation only. This test does not edit Mercury LiveScan, take or upload photos,
            change the preview, or modify AI inspections and estimates.
          </p>
          <Link href="/live-scan" className="inline-block text-sm font-semibold text-emerald-300 underline underline-offset-4">
            Return to Mercury LiveScan
          </Link>
        </header>

        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-contain" />
          {!running && <p className="px-4 py-4 text-center text-sm text-slate-300">Camera is off. Press Start Lighting Test to begin.</p>}
        </section>

        <div className="flex flex-wrap gap-3">
          {!running ? (
            <button type="button" onClick={() => void start()} disabled={starting}
              className="rounded-lg bg-amber-400 px-5 py-3 font-bold text-black disabled:opacity-60">
              {starting ? "Connecting…" : "START LIGHTING TEST"}
            </button>
          ) : (
            <button type="button" onClick={stop} className="rounded-lg bg-red-600 px-5 py-3 font-bold text-white">
              STOP TEST
            </button>
          )}
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950 p-3 text-sm text-red-100">{error}</p>}

        <section className="rounded-xl border border-slate-700 bg-slate-900 p-5" aria-label="Lighting observations">
          <h2 className="mb-3 text-xl font-bold">Live lighting observations</h2>
          {!report ? (
            <p className="text-sm text-slate-300">Live results will appear after the test camera starts.</p>
          ) : (
            <div className="space-y-4" aria-live="polite">
              <p className="text-lg font-semibold text-amber-300">{report.assessment}</p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-slate-400">Brightness</p><p className="text-lg font-bold">{report.brightness}%</p></div>
                <div><p className="text-slate-400">Dark pixels</p><p className="text-lg font-bold">{report.shadowPercent}%</p></div>
                <div><p className="text-slate-400">Clipped highlights</p><p className="text-lg font-bold">{report.highlightPercent}%</p></div>
                <div><p className="text-slate-400">Scene contrast</p><p className="text-lg font-bold">{report.contrast}%</p></div>
              </div>
              <p className="text-sm"><span className="text-slate-400">Color balance:</span> {report.colorCast}</p>
              <p className="rounded-lg bg-slate-800 p-3 text-sm">{report.recommendation}</p>
            </div>
          )}
        </section>

        <p className="text-xs leading-relaxed text-slate-400">
          Experimental on-device scene estimates, not calibrated light-meter readings.
          A phone camera may auto-adjust its exposure and white balance; colored objects can
          look like a color cast. This test cannot reliably identify bulb type, flicker,
          paint color, or surface defects. It does not save images or send camera data anywhere.
          Close this test before opening LiveScan to avoid competing for the camera.
        </p>
      </div>
    </main>
  );
}
