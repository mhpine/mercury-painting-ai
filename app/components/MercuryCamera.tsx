
"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

type Props = {
  onCapture: (file: File) => Promise<void>;
  onClose: () => void;
  disabled?: boolean;
  visible?: boolean;
};

/**
 * Shared full-screen camera for Mercury LiveScan and Walkthrough.
 *
 * - Rear camera preview
 * - Native or digital zoom
 * - Full-frame photo capture
 * - Optional live AI segmentation overlay
 * - Existing photo-analysis workflow remains unchanged
 */
export type MercuryCameraHandle = { start: () => void };

// LiveScan can request the existing camera stream directly from the first click.
// Other callers keep the original default-visible, manual-start behavior.
const MercuryCamera = forwardRef<MercuryCameraHandle, Props>(function MercuryCamera({
  onCapture,
  onClose,
  disabled = false,
  visible = true,
}, handleRef) {
  const cameraRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Camera requests cannot be cancelled, so stale results must be stopped.
  const requestNumberRef = useRef(0);
  // C4's single user-initiated camera request was the version that worked on the phone.
  const openingRef = useRef(false);
  const nativeCaptureRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const busyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [nativeZoom, setNativeZoom] = useState(false);
  const [maxZoom, setMaxZoom] = useState(3);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  // UI orientation is separate from the camera stream and never restarts it.
  type PhysicalTurn = "portrait" | "right" | "left";
  const [physicalTurn, setPhysicalTurn] = useState<PhysicalTurn>("portrait");

  // The browser viewport can change while the camera is open (rotation,
  // browser chrome appearing/disappearing, or Android entering fullscreen).
  useEffect(() => {
    const updateViewport = () => {
      const visible = window.visualViewport;
      setViewport({
        width: Math.round(visible?.width ?? window.innerWidth),
        height: Math.round(visible?.height ?? window.innerHeight),
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    screen.orientation?.addEventListener?.("change", updateViewport);
    document.addEventListener("fullscreenchange", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      screen.orientation?.removeEventListener?.("change", updateViewport);
      document.removeEventListener("fullscreenchange", updateViewport);
    };
  }, []);

  // Use the accelerometer for the physical bottom edge even when the browser
  // screen stays portrait-locked. Orientation data is a fallback when gravity
  // events are unavailable. Neither handler touches the video stream.
  useEffect(() => {
    let stable: PhysicalTurn = "portrait";
    let pending: PhysicalTurn | null = null;
    let pendingSince = 0;
    let lastGravityReading = 0;

    function report(next: PhysicalTurn | null) {
      if (!next) return; // Ignore flat, diagonal, and unreliable readings.
      if (next === stable) {
        pending = null;
        return;
      }
      const now = Date.now();
      if (pending !== next) {
        pending = next;
        pendingSince = now;
      } else if (now - pendingSince >= 350) {
        stable = next;
        pending = null;
        setPhysicalTurn(next);
      }
    }

    function onMotion(event: DeviceMotionEvent) {
      const g = event.accelerationIncludingGravity;
      if (g?.x == null || g.y == null) return;
      const x = g.x, y = g.y;
      // Screen nearly flat: gravity is on Z, not on screen X/Y.
      if (Math.max(Math.abs(x), Math.abs(y)) < 6) return;
      lastGravityReading = Date.now();
      if (Math.abs(x) > 6.5 && Math.abs(x) > Math.abs(y) * 1.25) {
        // accelerationIncludingGravity measures G-force opposite gravity.
        // Positive X means the LEFT edge is physically DOWN; U2 had this reversed.
        report(x > 0 ? "left" : "right");
      } else if (Math.abs(y) > 6.5 && Math.abs(y) > Math.abs(x) * 1.25) {
        report("portrait");
      }
    }

    function onOrientation(event: DeviceOrientationEvent) {
      // Ignore the gyroscope when the accelerometer is giving usable data;
      // conflicting streams can otherwise keep resetting the turning timer.
      if (Date.now() - lastGravityReading < 1800) return;
      if (event.gamma == null || event.beta == null) return;
      const gamma = event.gamma, beta = event.beta;
      if (Math.abs(gamma) > 50 && Math.abs(beta) < 110) {
        report(gamma > 0 ? "right" : "left");
      } else if (Math.abs(gamma) < 28 && Math.abs(beta) < 115) {
        report("portrait");
      }
    }

    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
    };
  }, []);

  // The camera has a clean view with only MARK and zoom controls.
  // Android/browser Back exits the LiveScan page; Escape closes the overlay
  // on laptops without adding a permanent button over the video.
  const stop = useCallback(() => {
    // Invalidate any permission request that may still be resolving.
    requestNumberRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    openingRef.current = false;
    setOpening(false);
    setReady(false);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, stop]);

  // IMPORTANT: a single user-initiated request, not an automatic request
  // on React mount. Never open two streams or automatically retry.
  const start = useCallback(async (mode: "rear" | "basic" = "rear") => {
    if (openingRef.current) return;
    // Release a previous active stream before starting a new one.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const requestId = ++requestNumberRef.current;
    openingRef.current = true;
    setOpening(true);
    setReady(false);
    setError("");
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera requires HTTPS or localhost.");
      }
      const constraints: MediaStreamConstraints = mode === "rear"
        ? { audio: false, video: { facingMode: { ideal: "environment" } } }
        : { audio: false, video: true };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== requestNumberRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview element is missing.");
      video.srcObject = stream;
      await video.play();
      if (requestId !== requestNumberRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & {
            zoom?: { min: number; max: number; step?: number };
          })
        | undefined;
      if (caps?.zoom && Number.isFinite(caps.zoom.max)) {
        setNativeZoom(true);
        setMaxZoom(Math.min(3, caps.zoom.max));
      } else {
        setNativeZoom(false);
        setMaxZoom(3);
      }
      setZoom(1);
      setReady(true);
    } catch (problem) {
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (requestId === requestNumberRef.current) {
        const err = problem instanceof Error ? problem : null;
        setError(`${mode === "rear" ? "Rear camera" : "Basic camera"}: ${err?.name || "Error"}: ${err?.message || "Unable to initialize video"}`);
      }
    } finally {
      if (requestId === requestNumberRef.current) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  }, []);

  // One tap on LiveScan invokes the SAME guarded, user-initiated start() call.
  // It does not add another getUserMedia request, retry, or startup effect.
  useImperativeHandle(handleRef, () => ({
    start: () => { void start("rear"); },
  }), [start]);
  // Keep the video element mounted so the click can request permission directly.
  // Hiding the camera (including after MARK) stops its stream immediately.
  useEffect(() => {
    if (!visible) stop();
  }, [visible, stop]);
  // Unmount: free the camera. In-flight requests are invalidated and their
  // eventual streams are stopped; no setState on unmounted components.
  useEffect(() => () => {
    requestNumberRef.current += 1;
    openingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // When WebRTC video is unavailable, Android/iOS can still take a native
  // photo and send it through the existing photo-analysis callback.
  const useNativePhoto = async (file: File | undefined) => {
    if (!file || disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onCapture(file);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Photo submission failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (nativeCaptureRef.current) nativeCaptureRef.current.value = "";
    }
  };

  async function changeZoom(next: number) {
    const value = Math.max(
      1,
      Math.min(maxZoom, Math.round(next * 10) / 10)
    );

    const track = streamRef.current?.getVideoTracks()[0];

    if (nativeZoom && track) {
      try {
        await track.applyConstraints({
          advanced: [
            { zoom: value } as MediaTrackConstraintSet,
          ],
        });
      } catch {
        setNativeZoom(false);
      }
    }

    setZoom(value);
  }

  async function capture() {
    if (busyRef.current || disabled) return;

    const video = videoRef.current;

    if (
      !video ||
      !ready ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      const canvas = document.createElement("canvas");

      const scale = Math.min(
        1,
        1920 / Math.max(video.videoWidth, video.videoHeight)
      );

      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);

      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Unable to capture photo.");
      }

      // Capture the original camera frame without AI colors.
      // Digital zoom is applied only when native zoom is unavailable.
      if (!nativeZoom && zoom > 1) {
        const sourceWidth = video.videoWidth / zoom;
        const sourceHeight = video.videoHeight / zoom;

        ctx.drawImage(
          video,
          (video.videoWidth - sourceWidth) / 2,
          (video.videoHeight - sourceHeight) / 2,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
      } else {
        ctx.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }

      let blob: Blob | null = null;

      for (const quality of [0.85, 0.7, 0.55]) {
        blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", quality);
        });

        if (blob && blob.size < 1_900_000) {
          break;
        }
      }

      if (!blob || blob.size >= 1_900_000) {
        throw new Error(
          "Image too large to analyze. Move closer and retry."
        );
      }

      const file = new File(
        [blob],
        `mercury-${Date.now()}.jpg`,
        { type: "image/jpeg" }
      );

      // Preserve the caller's existing photo analysis and approval.
      await onCapture(file);

    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Capture failed."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Keep U3’s working orientation mapping: G-force sign matches the device
  // orientation (gamma) fallback, so automatic side selection cannot put MARK
  // on the upper physical edge when the display remains portrait locked.
  // This dock is an entire *horizontal bar* (zoom - / MARK / zoom +).
  // When the handset is physically sideways but the viewport stays portrait,
  // rotate the whole bar and center MARK on the physical bottom (left/right).
  // Rotating just the buttons left MARK incorrectly centered in a vertical stack.
  const viewportPortrait = !viewport || viewport.height >= viewport.width;
  const effectiveTurn = physicalTurn;
  const dockIsSideways = ready && viewportPortrait && effectiveTurn !== "portrait";
  const dockRotation = effectiveTurn === "right" ? -90 : 90;
  const dockWidth = Math.max(235, Math.min(440, (viewport?.height ?? 700) - 120));
  const dockStyle = dockIsSideways
    ? {
        position: "absolute" as const,
        left: effectiveTurn === "right" ? "calc(100% - 47px)" : "47px",
        top: "50%",
        width: `${dockWidth}px`,
        transform: `translate(-50%, -50%) rotate(${dockRotation}deg)`,
        transformOrigin: "center center",
      }
    : {
        position: "absolute" as const,
        left: 0, right: 0, bottom: 0,
        paddingBottom: "max(20px, env(safe-area-inset-bottom))",
      };

  return (
    <div
      ref={cameraRef}
      role="dialog"
      aria-modal="true"
      aria-label="Mercury camera"
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-black text-white"
      style={{
        display: visible ? "flex" : "none",
        height: viewport ? `${viewport.height}px` : "100dvh",
        width: viewport ? `${viewport.width}px` : "100vw",
      }}
    >
      {/* Full-screen camera preview */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          transform:
            !nativeZoom && zoom > 1
              ? `scale(${zoom})`
              : undefined,
        }}
      />

      {/* Camera startup: request only after an explicit tap. */}
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-4 text-center">
          <div className="w-full max-w-sm rounded-xl bg-black/80 p-4">
            <p className="mb-3 text-sm font-bold">
              {opening ? "Connecting to phone camera…" : "Mercury camera · U4"}
            </p>
            {error && (
              <p role="alert" className="mb-3 break-words rounded-lg bg-red-950 p-3 text-left text-sm text-red-100">
                {error}
              </p>
            )}
            {!opening && (
              <div className="flex flex-col gap-2">
                {/* Exactly one startup action. C4's manual start avoids the
                    repeated mobile requests that caused video-source errors. */}
                <button type="button" onClick={() => void start("rear")}
                  className="rounded-lg bg-amber-400 px-4 py-3 font-bold text-black">
                  START CAMERA
                </button>
                {/* Native camera is available only if WebRTC actually fails. */}
                {error && <button type="button" disabled={disabled || busy}
                  onClick={() => nativeCaptureRef.current?.click()}
                  className="rounded-lg border border-white/60 px-4 py-3 font-semibold text-white disabled:opacity-50">
                  USE PHONE CAMERA INSTEAD
                </button>}
              </div>
            )}
          </div>
        </div>
      )}
      <input
        ref={nativeCaptureRef}
        className="hidden"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo using the phone camera"
        onChange={(event: { currentTarget: HTMLInputElement }) => void useNativePhoto(event.currentTarget.files?.[0])}
      />

      {/* Errors appear only when something fails; no permanent HUD or labels. */}
      {ready && error && (
        <p role="alert" className="pointer-events-none absolute inset-x-4 top-4 z-20 rounded-lg bg-red-950/85 px-3 py-2 text-center text-sm text-white">
          {error}
        </p>
      )}

      {/* Entire control bar follows the physical bottom edge of the handset. */}
      {ready && <div
        className="z-20 flex flex-col items-center gap-2 px-2"
        style={dockStyle}
      >
        <div className="flex w-full max-w-sm items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!ready || zoom <= 1 || busy}
            onClick={() => void changeZoom(zoom - 0.5)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/65 text-2xl disabled:opacity-40"
          >
            −
          </button>

          <button
            type="button"
            aria-label="Mark surface and capture photo"
            disabled={!ready || busy || disabled}
            onClick={() => void capture()}
            className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 border-white bg-amber-400 font-bold text-black shadow-xl disabled:opacity-50"
          >
            <span className="text-2xl leading-none">{busy ? "…" : "●"}</span>
            <span className="mt-1 text-[10px] leading-none">MARK</span>
          </button>

          <button
            type="button"
            aria-label="Zoom in"
            disabled={!ready || zoom >= maxZoom || busy}
            onClick={() => void changeZoom(zoom + 0.5)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-black/65 text-2xl disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>}
      <button type="button" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded focus:bg-black focus:px-4 focus:py-2" onClick={() => { stop(); onClose(); }}>
        Close camera
      </button>
    </div>
  );
});

export default MercuryCamera;
