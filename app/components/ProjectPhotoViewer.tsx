"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  url: string;
  name: string;
  onClose: () => void;
};

type Point = { x: number; y: number };
const clamp = (value: number) => Math.max(1, Math.min(6, value));

export default function ProjectPhotoViewer({ url, name, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const fingers = useRef(new Map<number, Point>());
  const lastFinger = useRef<Point | null>(null);
  const lastPinchDistance = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function resetView() {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }

  function changeZoom(factor: number) {
    setZoom((previous) => clamp(previous * factor));
    if (factor < 1 && zoom * factor <= 1) {
      setPosition({ x: 0, y: 0 });
    }
  }

  function getDistance(points: Point[]) {
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(fingers.current.values());
    lastFinger.current = points.length === 1 ? points[0] : null;
    lastPinchDistance.current = points.length === 2 ? getDistance(points) : null;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!fingers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    fingers.current.set(event.pointerId, point);
    const points = Array.from(fingers.current.values());

    if (points.length === 2) {
      const distance = getDistance(points);
      if (lastPinchDistance.current && lastPinchDistance.current > 0) {
        changeZoom(distance / lastPinchDistance.current);
      }
      lastPinchDistance.current = distance;
      lastFinger.current = null;
    } else if (points.length === 1) {
      if (lastFinger.current && zoom > 1) {
        const dx = point.x - lastFinger.current.x;
        const dy = point.y - lastFinger.current.y;
        setPosition((previous) => ({ x: previous.x + dx, y: previous.y + dy }));
      }
      lastFinger.current = point;
      lastPinchDistance.current = null;
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    fingers.current.delete(event.pointerId);
    const points = Array.from(fingers.current.values());
    lastFinger.current = points.length === 1 ? points[0] : null;
    lastPinchDistance.current = points.length === 2 ? getDistance(points) : null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect photo: ${name}`}
      className="fixed inset-0 z-[100] flex flex-col bg-[#101010] text-white"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/20 px-3 py-3">
        <p className="min-w-0 truncate text-sm font-bold">{name}</p>
        <button type="button" onClick={onClose} autoFocus className="rounded-lg border border-white/40 px-4 py-2 text-sm font-bold">Close ×</button>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: "none", cursor: zoom > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => zoom > 1 ? resetView() : changeZoom(2)}
      >
        {/* The original file is never modified by preview controls. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-contain"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/20 px-3 py-3">
        <button type="button" onClick={() => changeZoom(1.5)} className="rounded-lg border border-white/40 px-4 py-2 font-bold" aria-label="Zoom in">+ Zoom</button>
        <button type="button" onClick={() => changeZoom(1 / 1.5)} className="rounded-lg border border-white/40 px-4 py-2 font-bold" aria-label="Zoom out">− Zoom</button>
        <button type="button" onClick={resetView} className="rounded-lg border border-white/40 px-4 py-2 font-bold">Fit</button>
        <button type="button" onClick={() => setRotation((value) => (value - 90 + 360) % 360)} className="rounded-lg border border-white/40 px-4 py-2 font-bold" aria-label="Rotate left">↶</button>
        <button type="button" onClick={() => setRotation((value) => (value + 90) % 360)} className="rounded-lg border border-white/40 px-4 py-2 font-bold" aria-label="Rotate right">↷</button>
      </div>
      <p className="shrink-0 px-3 pb-3 text-center text-xs text-gray-300">Pinch to zoom · drag when enlarged · rotation is preview-only for this first test</p>
    </div>
  );
}
