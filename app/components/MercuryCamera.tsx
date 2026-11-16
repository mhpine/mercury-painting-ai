
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onCapture: (file: File) => Promise<void>;
  onClose: () => void;
  disabled?: boolean;
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
export default function MercuryCamera({
  onCapture,
  onClose,
  disabled = false,
}: Props) {
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
  const [message, setMessage] = useState("");
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [portraitLocked, setPortraitLocked] = useState(false);
  const orientationLockedRef = useRef(false);
  const mountedRef = useRef(false);

  // UI orientation is separate from the camera stream and never restarts it.
  type PhysicalTurn = "portrait" | "right" | "left";
  const [physicalTurn, setPhysicalTurn] = useState<PhysicalTurn>("portrait");
  const [manualTurn, setManualTurn] = useState<PhysicalTurn | null>(null);
  const [sensorStatus, setSensorStatus] = useState<"waiting" | "motion" | "orientation">("waiting");
  const [sensorNotice, setSensorNotice] = useState("");

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
    let sensor: "waiting" | "motion" | "orientation" = "waiting";

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
      if (sensor !== "motion") {
        sensor = "motion";
        setSensorStatus("motion");
      }
      if (Math.abs(x) > 6.5 && Math.abs(x) > Math.abs(y) * 1.25) {
        // The lowered physical side is the new bottom edge.
        report(x > 0 ? "right" : "left");
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
      if (sensor !== "orientation") {
        sensor = "orientation";
        setSensorStatus("orientation");
      }
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

  // iOS and some browsers need a direct tap before releasing motion-sensor
  // readings. Both permission requests are made immediately in the click
  // handler, before awaiting either one (user activation is required).
  async function enableMotionControls() {
    setManualTurn(null);
    setSensorNotice("");
    type PermissionAPI = { requestPermission?: () => Promise<"granted" | "denied"> };
    const motion = window.DeviceMotionEvent as unknown as PermissionAPI | undefined;
    const orientation = window.DeviceOrientationEvent as unknown as PermissionAPI | undefined;
    const requests: Promise<"granted" | "denied">[] = [];
    try {
      if (typeof motion?.requestPermission === "function") {
        requests.push(motion.requestPermission());
      }
      if (typeof orientation?.requestPermission === "function") {
        requests.push(orientation.requestPermission());
      }
      if (requests.length === 0) {
        setSensorNotice("Listening for movement. Turn the phone sideways.");
        return;
      }
      const results = await Promise.all(requests);
      setSensorNotice(results.every(result => result === "granted")
        ? "Motion enabled. Turn the phone sideways."
        : "Motion permission was denied; use MOVE BTNS instead.");
    } catch {
      setSensorNotice("Motion access unavailable; use MOVE BTNS instead.");
    }
  }

  // Only lock while MercuryCamera is mounted, never in other Mercury pages.
  // Mobile browsers often require fullscreen before allowing a lock.
  const requestPortraitLock = useCallback(async (showFailure: boolean): Promise<boolean> => {
    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (mode: "portrait-primary") => Promise<void>;
    }) | undefined;

    if (!orientation?.lock) {
      if (showFailure && mountedRef.current) {
        setMessage("This browser cannot lock portrait. Camera remains active; use MOVE BTNS if motion sensing is blocked.");
      }
      return false;
    }

    try {
      await orientation.lock("portrait-primary");
      if (!mountedRef.current) {
        orientation.unlock();
        return false;
      }
      orientationLockedRef.current = true;
      setPortraitLocked(true);
      setMessage("");
      return true;
    } catch {
      if (showFailure && mountedRef.current) {
        setMessage("Browser blocked portrait lock. Use Mercury as an installed app or use MOVE BTNS; camera remains active.");
      }
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Keep physical orientation locking separate from camera startup.
    // The LOCK PORTRAIT button remains available after video is running.

    const syncFullscreen = () => {
      if (!document.fullscreenElement && orientationLockedRef.current) {
        // Some browsers release a lock when they leave fullscreen.
        orientationLockedRef.current = false;
        setPortraitLocked(false);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("fullscreenchange", syncFullscreen);
      if (orientationLockedRef.current) {
        screen.orientation?.unlock();
        orientationLockedRef.current = false;
      }
    };
  }, [requestPortraitLock]);

  // On ordinary Chrome tabs, entering fullscreen requires a user tap.
  // This is the only reliable fallback when the automatic lock is denied.
  async function enablePortraitLock() {
    if (portraitLocked) return;
    try {
      if (!document.fullscreenElement && cameraRef.current?.requestFullscreen) {
        await cameraRef.current.requestFullscreen();
      }
    } catch {
      // A lock may still work without fullscreen (e.g. installed PWA).
    }
    await requestPortraitLock(true);
  }

  function closeCamera() {
    stop();
    if (orientationLockedRef.current) {
      screen.orientation?.unlock();
      orientationLockedRef.current = false;
    }
    if (document.fullscreenElement === cameraRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }

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
    setMessage("");
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
      setMessage(mode === "basic" ? "Basic camera stream active." : "Rear camera stream active.");
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
    setMessage("");

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

      setMessage("Photo captured.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Capture failed."
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // This dock is an entire *horizontal bar* (zoom - / MARK / zoom +).
  // When the handset is physically sideways but the viewport stays portrait,
  // rotate the whole bar and center MARK on the physical bottom (left/right).
  // Rotating just the buttons left MARK incorrectly centered in a vertical stack.
  const viewportPortrait = !viewport || viewport.height >= viewport.width;
  const effectiveTurn = manualTurn ?? physicalTurn;
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

      {/* Top visibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent" />

      {/* Camera header */}
      <div
        className="relative z-20 flex w-full shrink-0 items-start justify-between gap-1 px-2 pt-3 sm:gap-2 sm:px-4 sm:pt-4"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <span className="max-w-[34%] shrink rounded-full bg-black/60 px-2 py-2 text-[10px] font-bold tracking-wide sm:px-3 sm:text-xs">
          MERCURY CAMERA · U2
        </span>

        <div className="flex shrink-0 items-center gap-1">
          {ready && <button
            type="button"
            aria-label={portraitLocked ? "Portrait orientation locked" : "Lock camera to portrait"}
            onClick={() => void enablePortraitLock()}
            disabled={portraitLocked}
            className="flex h-11 items-center justify-center rounded-full bg-black/70 px-2 text-[10px] font-bold disabled:opacity-75 sm:h-12 sm:px-3 sm:text-xs"
          >
            {portraitLocked ? "PORTRAIT ✓" : "LOCK PORTRAIT"}
          </button>}
          {ready && <button
            type="button"
            aria-label="Enable automatic physical rotation of Mark and zoom controls"
            onClick={() => void enableMotionControls()}
            className="rounded-lg bg-black/75 px-2 py-3 text-[10px] font-bold"
          >
            AUTO BTNS
          </button>}
          {ready && <button
            type="button"
            aria-label="Move camera controls manually; tap to cycle right, left, portrait and automatic"
            onClick={() => setManualTurn((current) => current === null ? "right" : current === "right" ? "left" : current === "left" ? "portrait" : null)}
            className="rounded-lg bg-black/75 px-2 py-3 text-[10px] font-bold"
          >
            {manualTurn === null ? "MOVE BTNS" : manualTurn === "right" ? "RIGHT" : manualTurn === "left" ? "LEFT" : "PORTRAIT"}
          </button>}
          <button
            type="button"
            aria-label="Close camera"
            onClick={closeCamera}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-2xl sm:h-12 sm:w-12"
          >
            ×
          </button>
        </div>
      </div>

      {/* Camera startup: request only after an explicit tap. */}
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-4 text-center">
          <div className="w-full max-w-sm rounded-xl bg-black/80 p-4">
            <p className="mb-3 text-sm font-bold">
              {opening ? "Connecting to phone camera…" : "Mercury camera · U2 (manual start)"}
            </p>
            {error && (
              <p role="alert" className="mb-3 break-words rounded-lg bg-red-950 p-3 text-left text-sm text-red-100">
                {error}
              </p>
            )}
            {!opening && (
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => void start("rear")}
                  className="rounded-lg bg-amber-400 px-4 py-3 font-bold text-black">
                  Start rear camera
                </button>
                <button type="button" onClick={() => void start("basic")}
                  className="rounded-lg border border-white/70 bg-slate-800 px-4 py-3 font-semibold text-white">
                  Test basic camera
                </button>
                <button type="button" disabled={disabled || busy}
                  onClick={() => nativeCaptureRef.current?.click()}
                  className="rounded-lg border border-white/60 px-4 py-3 font-semibold text-white disabled:opacity-50">
                  Take a photo using phone camera instead
                </button>
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

      {/* Bottom visibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 to-transparent" />

      {/* Visible diagnostic: verifies whether physical sensor updates arrive. */}
      {ready && (
        <div className="pointer-events-none absolute left-2 right-2 top-20 z-20 text-center text-[11px] text-white">
          <span className="inline-block rounded bg-black/65 px-2 py-1">
            {manualTurn !== null
              ? `BUTTONS: MANUAL ${manualTurn.toUpperCase()}`
              : `BUTTONS: ${sensorStatus === "waiting" ? "WAITING FOR SENSOR" : `${physicalTurn.toUpperCase()} · ${sensorStatus.toUpperCase()}`}`}
          </span>
          {sensorNotice && <p className="mt-1 rounded bg-black/65 px-2 py-1">{sensorNotice}</p>}
          {(error || message) && <p role="status" className="mt-1 rounded bg-black/65 px-2 py-1">{error || message}</p>}
        </div>
      )}

      {/* Entire control bar follows the physical bottom edge of the handset. */}
      <div
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
        <span className="rounded-full bg-black/60 px-3 py-1 text-xs">
          {zoom.toFixed(1)}×
        </span>
      </div>
    </div>
  );
}
