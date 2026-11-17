"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * ECI Adaptive Vision — Phase 3, isolated inspection-evidence laboratory.
 *
 * IMPORTANT: This page NEVER imports MercuryCamera, Mercury LiveScan, Supabase,
 * AI inspection, or estimates. It does not upload or persist any camera frames.
 * The native camera stream is untouched by the color / brightness adjustments.
 * Paired test captures are retained only in browser memory until this page is closed.
 * All correction happens ONLY in an in-memory canvas.
 */

const SAMPLE_W = 96;
const SAMPLE_H = 54;
const SAMPLE_INTERVAL_MS = 550;
const DISPLAY_INTERVAL_MS = 100; // <= 10 adjusted frames per second on mobile
const DISPLAY_MAX_W = 480;
const DISPLAY_MAX_H = 360;

type LightingReading = {
  brightness: number;
  darkPercent: number;
  clippedPercent: number;
  contrast: number;
  neutralCoverage: number;
  possibleCast: string;
  condition: string;
  caution: string;
};

type Correction = {
  gamma: number;
  redGain: number;
  greenGain: number;
  blueGain: number;
};

type Lookup = { red: Uint8ClampedArray; green: Uint8ClampedArray; blue: Uint8ClampedArray };

type InspectionSample = {
  original: string;
  adaptive: string;
  capturedAt: string;
  reading: LightingReading;
  reliability: "Poor" | "Review carefully" | "Usable with verification";
  reason: string;
};

type Review = {
  defect: string;
  verdict: string;
  notes: string;
};

const INITIAL_REVIEW: Review = { defect: "Crack", verdict: "Not reviewed", notes: "" };

function reliabilityCheck(reading: LightingReading): { reliability: InspectionSample["reliability"]; reason: string } {
  // Heuristic capture-quality warnings, not an AI confidence score or proof of a defect.
  if (reading.brightness < 20 || reading.darkPercent > 65 || reading.clippedPercent > 22) {
    return { reliability: "Poor", reason: "Too much shadow, insufficient light or clipped detail. Re-light or change angle and capture again." };
  }
  if (reading.darkPercent > 30 || reading.clippedPercent > 9 ||
      reading.condition === "Mixed / harsh lighting" || reading.possibleCast.startsWith("Possible")) {
    return { reliability: "Review carefully", reason: "Lighting may mimic stains, cracks or uneven coating. Verify the surface in person and compare the original." };
  }
  return { reliability: "Usable with verification", reason: "Image appears reasonably exposed. This is not a defect-accuracy guarantee; verify on site." };
}


const IDENTITY: Correction = { gamma: 1, redGain: 1, greenGain: 1, blueGain: 1 };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function createLookup(correction: Correction): Lookup {
  const red = new Uint8ClampedArray(256);
  const green = new Uint8ClampedArray(256);
  const blue = new Uint8ClampedArray(256);
  for (let input = 0; input < 256; input += 1) {
    const toned = 255 * Math.pow(input / 255, correction.gamma);
    red[input] = clamp(Math.round(toned * correction.redGain), 0, 255);
    green[input] = clamp(Math.round(toned * correction.greenGain), 0, 255);
    blue[input] = clamp(Math.round(toned * correction.blueGain), 0, 255);
  }
  return { red, green, blue };
}

function analyzeFrame(data: Uint8ClampedArray): { reading: LightingReading; correction: Correction } {
  const count = data.length / 4;
  const histogram = new Uint32Array(256);
  let lumaSum = 0;
  let dark = 0;
  let clipped = 0;
  let neutralCount = 0;
  let redNeutralSum = 0;
  let greenNeutralSum = 0;
  let blueNeutralSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    const luma = clamp(Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722), 0, 255);
    histogram[luma] += 1;
    lumaSum += luma;
    if (luma < 45) dark += 1;
    if (luma > 242) clipped += 1;

    // Colored surfaces must not automatically be treated as neutral references.
    if (luma >= 65 && luma <= 215 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 65) {
      neutralCount += 1;
      redNeutralSum += red;
      greenNeutralSum += green;
      blueNeutralSum += blue;
    }
  }

  const mean = lumaSum / Math.max(count, 1);
  const darkPercent = 100 * dark / Math.max(count, 1);
  const clippedPercent = 100 * clipped / Math.max(count, 1);
  const neutralCoverage = 100 * neutralCount / Math.max(count, 1);
  const percentile = (fraction: number): number => {
    const target = Math.ceil(count * fraction);
    let seen = 0;
    for (let index = 0; index < 256; index += 1) {
      seen += histogram[index];
      if (seen >= target) return index;
    }
    return 255;
  };
  const contrast = percentile(0.95) - percentile(0.05);
  let possibleCast = "Insufficient neutral reference";
  let redGain = 1;
  let greenGain = 1;
  let blueGain = 1;

  if (neutralCoverage >= 7) {
    const avgRed = redNeutralSum / neutralCount;
    const avgGreen = greenNeutralSum / neutralCount;
    const avgBlue = blueNeutralSum / neutralCount;
    const neutralAverage = (avgRed + avgGreen + avgBlue) / 3;
    const rb = avgRed - avgBlue;
    const g = avgGreen - (avgRed + avgBlue) / 2;
    if (g > 13) possibleCast = "Possible green cast";
    else if (rb > 17) possibleCast = "Possible warm / yellow cast";
    else if (rb < -17) possibleCast = "Possible cool / blue cast";
    else possibleCast = "No strong cast detected";

    // Deliberately subtle neutral-balance adjustment: never infer bulb type.
    redGain = clamp(neutralAverage / Math.max(avgRed, 1), 0.93, 1.07);
    greenGain = clamp(neutralAverage / Math.max(avgGreen, 1), 0.93, 1.07);
    blueGain = clamp(neutralAverage / Math.max(avgBlue, 1), 0.93, 1.07);
  }

  // Bounded tone correction. Cannot restore sensor noise or clipped detail.
  let gamma = clamp(Math.log(0.46) / Math.log(clamp(mean / 255, 0.04, 0.96)), 0.72, 1.25);
  if (clippedPercent > 18) gamma = Math.max(gamma, 1.07);
  if (clippedPercent > 6 && darkPercent > 45) gamma = clamp(gamma, 0.89, 1.11);

  let condition = "Usable lighting";
  let caution = "Enhanced preview is for visibility only. Inspect the original for accurate surface evidence.";
  if (mean < 50 || darkPercent > 65) {
    condition = "Low light";
    caution = "Add a light before judging fine defects. Software cannot recover detail the sensor did not capture.";
  } else if (clippedPercent > 18) {
    condition = "Overexposed highlights";
    caution = "Change the camera angle to reduce glare. Clipped detail cannot be restored.";
  } else if (darkPercent > 18 && clippedPercent > 4 && contrast > 185) {
    condition = "Mixed / harsh lighting";
    caution = "Check the original image for shadow boundaries and glare before accepting a surface finding.";
  } else if (possibleCast.startsWith("Possible")) {
    condition = "Possible color cast";
    caution = "White balance is tentative; check paint discoloration under neutral light.";
  }

  return {
    reading: {
      brightness: Math.round(mean / 255 * 100),
      darkPercent: Math.round(darkPercent),
      clippedPercent: Math.round(clippedPercent),
      contrast: Math.round(contrast / 255 * 100),
      neutralCoverage: Math.round(neutralCoverage),
      possibleCast,
      condition,
      caution,
    },
    correction: { gamma, redGain, greenGain, blueGain },
  };
}

export default function LightingLabPhase3() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const enhancedRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startSequenceRef = useRef(0);
  const startingRef = useRef(false);
  const correctionRef = useRef<Correction>({ ...IDENTITY });
  const lookupRef = useRef<Lookup>(createLookup(IDENTITY));
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<LightingReading | null>(null);
  const [adjustment, setAdjustment] = useState("Waiting for camera");
  const [sample, setSample] = useState<InspectionSample | null>(null);
  const [review, setReview] = useState<Review>({ ...INITIAL_REVIEW });
  const [processing, setProcessing] = useState(false);
  const [processingMs, setProcessingMs] = useState<number | null>(null);
  const lastProcessingUpdateRef = useRef(0);

  const release = useCallback(() => {
    startSequenceRef.current += 1;
    startingRef.current = false;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setRunning(false);
    setStarting(false);
    setReading(null);
    setAdjustment("Waiting for camera");
    setProcessingMs(null);
    correctionRef.current = { ...IDENTITY };
    lookupRef.current = createLookup(IDENTITY);
  }, [release]);

  const start = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    const sequence = ++startSequenceRef.current;
    setStarting(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires HTTPS and permission.");
      }
      // Single request after a direct tap; no auto-start/retries or changes to camera constraints.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (sequence !== startSequenceRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      if (sequence !== startSequenceRef.current) return;
      setRunning(true);
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      if (sequence === startSequenceRef.current) {
        streamRef.current = null;
        setError(cause instanceof Error ? cause.message : "Could not open the test camera.");
      }
    } finally {
      if (sequence === startSequenceRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = SAMPLE_W;
    sampleCanvas.height = SAMPLE_H;
    const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setError("This browser cannot analyze the video pixels.");
      return;
    }
    const measure = () => {
      if (document.hidden) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        const result = analyzeFrame(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
        setReading(result.reading);
        // Smooth automatic changes to prevent correction pumping or flickering.
        const current = correctionRef.current;
        const target = result.correction;
        const mix = 0.5;
        const next: Correction = {
          gamma: current.gamma + (target.gamma - current.gamma) * mix,
          redGain: current.redGain + (target.redGain - current.redGain) * mix,
          greenGain: current.greenGain + (target.greenGain - current.greenGain) * mix,
          blueGain: current.blueGain + (target.blueGain - current.blueGain) * mix,
        };
        correctionRef.current = next;
        lookupRef.current = createLookup(next);
        const tone = next.gamma < 0.96 ? "Brightening darker detail" : next.gamma > 1.05 ? "Reducing excessive brightness" : "Brightness near neutral";
        const balance = result.reading.possibleCast.startsWith("Possible") ? " · gentle color balancing" : "";
        setAdjustment(tone + balance);
      } catch {
        setError("The lighting reading is unavailable. LiveScan remains unaffected.");
      }
    };
    measure();
    const id = window.setInterval(measure, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const canvas = enhancedRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) {
      setError("Enhanced preview is unavailable in this browser.");
      return;
    }
    let frameId = 0;
    let lastFrame = 0;
    let consecutiveFailures = 0;
    const draw = (time: number) => {
      if (document.hidden) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      if (time - lastFrame < DISPLAY_INTERVAL_MS) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      lastFrame = time;
      const video = videoRef.current;
      if (video?.readyState && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        try {
          const scale = Math.min(1, DISPLAY_MAX_W / video.videoWidth, DISPLAY_MAX_H / video.videoHeight);
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          ctx.drawImage(video, 0, 0, width, height);
          const startedAt = performance.now();
          const image = ctx.getImageData(0, 0, width, height);
          const pixels = image.data;
          const { red, green, blue } = lookupRef.current;
          for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = red[pixels[i]];
            pixels[i + 1] = green[pixels[i + 1]];
            pixels[i + 2] = blue[pixels[i + 2]];
          }
          ctx.putImageData(image, 0, 0);
          if (time - lastProcessingUpdateRef.current > 1250) {
            lastProcessingUpdateRef.current = time;
            setProcessingMs(Math.round(performance.now() - startedAt));
          }
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures === 1) setError("Live correction could not process a frame. The original video is still available.");
          if (consecutiveFailures > 2) return; // stop retrying on unsupported devices
        }
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [running]);

  useEffect(() => {
    const onPageHide = () => stop();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      release();
    };
  }, [release, stop]);

  // ONE source frame for both exports; no uploads, no database writes, no AI endpoint.
  // We intentionally keep the preview pixel pipeline aligned with Phase 2.
  const capturePair = useCallback(() => {
    const video = videoRef.current;
    if (!running || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || processing) return;
    setProcessing(true);
    setError("");
    try {
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Capture canvas is unavailable.");
      ctx.drawImage(video, 0, 0, width, height);
      const raw = ctx.getImageData(0, 0, width, height);
      // Same uncorrected frame: original JPEG encoded before any enhancement.
      const original = canvas.toDataURL("image/jpeg", 0.88);
      const sampled = document.createElement("canvas");
      sampled.width = SAMPLE_W;
      sampled.height = SAMPLE_H;
      const sampleCtx = sampled.getContext("2d", { willReadFrequently: true });
      if (!sampleCtx) throw new Error("Lighting sampling is unavailable.");
      sampleCtx.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
      const capturedReading = analyzeFrame(sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data).reading;
      const quality = reliabilityCheck(capturedReading);
      const pixels = raw.data;
      const { red, green, blue } = lookupRef.current;
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = red[pixels[i]];
        pixels[i + 1] = green[pixels[i + 1]];
        pixels[i + 2] = blue[pixels[i + 2]];
      }
      ctx.putImageData(raw, 0, 0);
      const adaptive = canvas.toDataURL("image/jpeg", 0.88);
      setSample({ original, adaptive, reading: capturedReading, capturedAt: new Date().toLocaleString(), ...quality });
      setReview({ ...INITIAL_REVIEW });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not capture this lighting sample.");
    } finally {
      setProcessing(false);
    }
  }, [running, processing]);

  // Export local review notes separately from the two optional photo downloads.
  const downloadReview = useCallback(() => {
    if (!sample) return;
    const report = {
      product: "ECI Adaptive Vision",
      lab: "Phase 3 - manual lighting evidence evaluation",
      capturedAt: sample.capturedAt,
      lighting: sample.reading,
      lightingReliabilityHeuristic: sample.reliability,
      reliabilityReason: sample.reason,
      manualSiteReview: review,
      photos: ["adaptive-vision-original.jpg", "adaptive-vision-corrected.jpg"],
      note: "No automatic defect inference was performed; findings require on-site verification.",
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "adaptive-vision-review.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [sample, review]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-7 text-white">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">ECI Adaptive Vision · Lab 3</p>
          <h1 className="text-3xl font-bold">Inspection Evidence &amp; Lighting Reliability</h1>
          <p className="text-sm text-slate-300">
            This preview-only laboratory compares the untouched camera feed with adaptive correction, then lets you
            capture matching ORIGINAL and ADAPTIVE photos from the same instant. Images remain in this browser tab
            unless you deliberately download them. No upload, AI diagnosis, estimate, or project write occurs.
          </p>
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            <Link href="/lighting-lab/phase2" className="text-emerald-300 underline underline-offset-4">Back to Phase 2</Link>
            <Link href="/live-scan" className="text-emerald-300 underline underline-offset-4">Mercury LiveScan (unchanged)</Link>
          </div>
        </header>

        <div className="flex flex-wrap gap-3">
          {!running ? (
            <button type="button" disabled={starting} onClick={() => void start()}
              className="rounded-lg bg-amber-400 px-5 py-3 font-bold text-black disabled:opacity-60">
              {starting ? "Connecting…" : "START LIGHTING CORRECTION TEST"}
            </button>
          ) : (
            <button type="button" onClick={stop} className="rounded-lg bg-red-600 px-5 py-3 font-bold text-white">STOP TEST</button>
          )}
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950 p-3 text-sm text-red-100">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
          <button type="button" onClick={capturePair} disabled={!running || processing}
            className="rounded-lg bg-emerald-500 px-5 py-3 font-bold text-slate-950 disabled:opacity-50">
            {processing ? "Capturing…" : "CAPTURE ORIGINAL + ADAPTIVE PAIR"}
          </button>
          <span className="text-xs text-slate-300">Capture a single frame in both versions for inspection-quality review. One pair held in memory at a time.</span>
        </div>

        <section className="grid gap-4 sm:grid-cols-2" aria-label="Original versus corrected camera comparison">
          <div className="overflow-hidden rounded-2xl border border-slate-700 bg-black">
            <div className="bg-slate-900 px-4 py-2 text-sm font-bold">ORIGINAL · Untouched</div>
            <video ref={videoRef} muted playsInline autoPlay className="aspect-video w-full object-contain" />
            {!running && <p className="p-3 text-center text-xs text-slate-400">The original camera feed will appear here.</p>}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-700 bg-black">
            <div className="bg-slate-900 px-4 py-2 text-sm font-bold text-emerald-300">ADAPTIVE · Corrected preview</div>
            <canvas ref={enhancedRef} aria-label="Lighting-corrected preview" className="aspect-video w-full object-contain" />
            {!running && <p className="p-3 text-center text-xs text-slate-400">Automatic correction appears here.</p>}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5" aria-label="Captured evidence pair">
          <h2 className="text-xl font-bold">Paired inspection evidence — local only</h2>
          {!sample ? (
            <p className="text-sm text-slate-300">Start the test and capture a pair to compare a single instant under identical lighting.</p>
          ) : (
            <>
              <p className="text-sm text-slate-300">Captured {sample.capturedAt} · Both images are scaled to at most 1280 pixels to limit phone memory. They have identical framing and timing.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
                  <p className="bg-slate-800 px-3 py-2 text-sm font-semibold">Original · Color uncorrected</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sample.original} alt="Original sample captured from live video" className="w-full object-contain" />
                  <a href={sample.original} download="adaptive-vision-original.jpg"
                    className="block p-3 text-sm font-semibold text-emerald-300 underline">Download original JPEG</a>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
                  <p className="bg-slate-800 px-3 py-2 text-sm font-semibold">Adaptive · Visibility-enhanced</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sample.adaptive} alt="Same sample with adaptive lighting correction" className="w-full object-contain" />
                  <a href={sample.adaptive} download="adaptive-vision-corrected.jpg"
                    className="block p-3 text-sm font-semibold text-emerald-300 underline">Download corrected JPEG</a>
                </div>
              </div>
              <div className="rounded-lg border border-amber-600/50 bg-slate-800 p-3">
                <p className="font-semibold text-amber-300">Lighting assessment: {sample.reliability}</p>
                <p className="mt-1 text-sm text-slate-200">{sample.reason}</p>
                <p className="mt-2 text-xs text-slate-400">Capture brightness: {sample.reading.brightness}% · Dark areas: {sample.reading.darkPercent}% · Clipped highlights: {sample.reading.clippedPercent}%</p>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-600 p-4">
                <h3 className="font-bold">Site verification checklist</h3>
                <p className="text-sm text-slate-300">This is a manual review, not automatic defect recognition. Confirm any defect by looking at the actual surface and the ORIGINAL frame.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">Candidate surface issue
                    <select value={review.defect} onChange={event => setReview(prev => ({...prev, defect: event.target.value}))}
                      className="mt-1 w-full rounded-lg border border-slate-500 bg-slate-800 p-2 text-white">
                      {["Crack", "Peeling paint", "Stain / discoloration", "Texture irregularity", "Moisture suspicion", "None visible", "Other"].map(item => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">Site finding
                    <select value={review.verdict} onChange={event => setReview(prev => ({...prev, verdict: event.target.value}))}
                      className="mt-1 w-full rounded-lg border border-slate-500 bg-slate-800 p-2 text-white">
                      {["Not reviewed", "Confirmed on site", "Likely lighting artifact", "Uncertain — retake photo"].map(item => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">Review notes
                  <textarea rows={2} value={review.notes} onChange={event => setReview(prev => ({...prev, notes: event.target.value}))}
                    placeholder="What changed between original and corrected? What did you verify on site?"
                    className="mt-1 w-full rounded-lg border border-slate-500 bg-slate-800 p-2 text-white" />
                </label>
                <button type="button" onClick={downloadReview}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950">Download review notes (.json)</button>
                <p className="text-xs text-amber-200">Review is temporary until you download it. Download the two photos separately if needed. The Lab never saves this review to Mercury projects.</p>
              </div>
              <button type="button" onClick={() => {setSample(null); setReview({...INITIAL_REVIEW});}}
                className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold">Clear captured pair</button>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5" aria-label="Lighting analysis">
          <h2 className="text-xl font-bold">Live lighting analysis</h2>
          {!reading ? (
            <p className="text-sm text-slate-300">Start the test to compare the unmodified and adjusted camera feeds.</p>
          ) : (
            <div className="space-y-3" aria-live="polite">
              <p className="font-semibold text-amber-300">{reading.condition}</p>
              <p className="text-sm text-emerald-300">{adjustment}</p>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-slate-400">Brightness</p><p className="text-xl font-bold">{reading.brightness}%</p></div>
                <div><p className="text-slate-400">Shadows</p><p className="text-xl font-bold">{reading.darkPercent}%</p></div>
                <div><p className="text-slate-400">Clipped light</p><p className="text-xl font-bold">{reading.clippedPercent}%</p></div>
                <div><p className="text-slate-400">Scene contrast</p><p className="text-xl font-bold">{reading.contrast}%</p></div>
              </div>
              <p className="text-sm"><span className="text-slate-400">Possible color cast:</span> {reading.possibleCast}</p>
              <p className="text-xs text-slate-400">Near-neutral reference pixels: {reading.neutralCoverage}% (the lighting source itself cannot be identified reliably).</p>
              <p className="text-xs text-slate-400">Latest correction processing: {processingMs === null ? "Measuring…" : `${processingMs} ms per preview frame`} at a maximum target of 10 fps. This is not battery/heat measurement.</p>
              <p className="rounded-lg bg-slate-800 p-3 text-sm">{reading.caution}</p>
            </div>
          )}
        </section>

        <p className="text-xs leading-relaxed text-slate-400">
          Experimental software correction only, not calibrated exposure or white balance. Brightening does not restore missing details,
          remove sensor noise, or reverse clipped highlights. Wall colors and mixed light can mislead automatic white balance.
          The reliability label is a simple lighting heuristic, NOT proof of correct defect recognition or a validated AI confidence score.
          Inspection decisions require the original image and a real-world site check. This lab does not call AI analysis,
          save project records, or affect Mercury's production MARK/zoom controls, photo capture, or estimates.
          Stop this test before opening LiveScan.
        </p>
      </div>
    </main>
  );
}
