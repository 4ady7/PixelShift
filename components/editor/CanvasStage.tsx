"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import type { Tool } from "@/lib/editor/types";
import { fillPolygon, fillRect, stamp, type Mask, type Point } from "@/lib/mask/mask";

export type StageHandle = {
  fit: () => void;
  actualSize: () => void;
};

type CanvasStageProps = {
  imageUrl: string;
  originalUrl: string;
  viewKey: string;
  width: number;
  height: number;
  maskRef: RefObject<Mask | null>;
  maskRevision: number;
  showMask: boolean;
  compare: boolean;
  split: boolean;
  splitRatio: number;
  tool: Tool;
  spacePan: boolean;
  brushSize: number;
  brushSoftness: number;
  onSplitRatio: (ratio: number) => void;
  onStrokeCommit: (before: Uint8Array) => void;
  onZoomChange: (zoom: number) => void;
};

export const CanvasStage = forwardRef<StageHandle, CanvasStageProps>(function CanvasStage(props, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const onZoomChangeRef = useRef(props.onZoomChange);
  onZoomChangeRef.current = props.onZoomChange;
  const propsRef = useRef(props);
  propsRef.current = props;

  const gesture = useRef<{
    mode: "draw" | "pan" | "shape" | "lasso" | "split" | null;
    before: Uint8Array | null;
    last: Point | null;
    start: Point | null;
    points: Point[];
    pointer: number | null;
    panX: number;
    panY: number;
    clientX: number;
    clientY: number;
  }>({
    mode: null,
    before: null,
    last: null,
    start: null,
    points: [],
    pointer: null,
    panX: 0,
    panY: 0,
    clientX: 0,
    clientY: 0,
  });

  function applyView() {
    const world = worldRef.current;
    if (!world) return;
    const zoom = zoomRef.current;
    world.style.width = `${propsRef.current.width * zoom}px`;
    world.style.height = `${propsRef.current.height * zoom}px`;
    world.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px)`;
  }

  function fit() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 24);
    const availableHeight = Math.max(80, viewport.clientHeight - 16);
    const zoom = Math.min(availableWidth / propsRef.current.width, availableHeight / propsRef.current.height) * 0.94;
    zoomRef.current = clamp(zoom, 0.05, 12);
    panRef.current = {
      x: (availableWidth - propsRef.current.width * zoomRef.current) / 2,
      y: Math.max(12, (availableHeight - propsRef.current.height * zoomRef.current) / 2),
    };
    applyView();
    onZoomChangeRef.current(zoomRef.current);
  }

  function actualSize() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    zoomRef.current = 1;
    panRef.current = {
      x: (viewport.clientWidth - propsRef.current.width) / 2,
      y: Math.max(8, (viewport.clientHeight - propsRef.current.height) / 2),
    };
    applyView();
    onZoomChangeRef.current(1);
  }

  useImperativeHandle(ref, () => ({ fit, actualSize }));

  const fitRef = useRef<() => void>(() => {});
  fitRef.current = fit;

  useLayoutEffect(() => {
    fit();
    // Fit when a new photograph opens. Later edits keep the current view.
  }, [props.viewKey, props.width, props.height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const previous = zoomRef.current;
      const imageX = (cursorX - panRef.current.x) / previous;
      const imageY = (cursorY - panRef.current.y) / previous;
      const next = clamp(previous * (event.deltaY < 0 ? 1.08 : 1 / 1.08), 0.05, 12);
      zoomRef.current = next;
      panRef.current = { x: cursorX - imageX * next, y: cursorY - imageY * next };
      applyView();
      onZoomChangeRef.current(next);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    redrawOverlay(overlayRef.current, props.maskRef.current, props.showMask && !props.compare);
  }, [props.maskRevision, props.showMask, props.compare, props.width, props.height, props.maskRef]);

  function imagePoint(event: React.PointerEvent): Point | null {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function paintStroke(from: Point, to: Point) {
    const mask = props.maskRef.current;
    if (!mask) return;
    const radius = Math.max(0.5, props.brushSize / 2 / zoomRef.current);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(1, radius * 0.25);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      stamp(mask, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, props.brushSoftness, props.tool === "erase");
    }
    if (!props.showMask) return;
    const pad = radius + 2;
    paintMaskRect(
      overlayRef.current?.getContext("2d") ?? null,
      mask,
      Math.min(from.x, to.x) - pad,
      Math.min(from.y, to.y) - pad,
      Math.max(from.x, to.x) + pad,
      Math.max(from.y, to.y) + pad,
    );
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button === 2) return;
    const point = imagePoint(event);
    if (!point && event.button !== 1) return;
    const wantsPan = event.button === 1 || props.tool === "pan" || props.spacePan;
    gesture.current.pointer = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (wantsPan) {
      gesture.current.mode = "pan";
      gesture.current.clientX = event.clientX;
      gesture.current.clientY = event.clientY;
      gesture.current.panX = panRef.current.x;
      gesture.current.panY = panRef.current.y;
      return;
    }
    const mask = props.maskRef.current;
    if (!mask || !point) return;
    gesture.current.before = mask.data.slice();
    gesture.current.last = point;
    gesture.current.start = point;
    if (props.tool === "brush" || props.tool === "erase") {
      gesture.current.mode = "draw";
      paintStroke(point, point);
      return;
    }
    if (props.tool === "rect") {
      gesture.current.mode = "shape";
      return;
    }
    if (props.tool === "lasso") {
      gesture.current.mode = "lasso";
      gesture.current.points = [point];
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current.pointer !== event.pointerId) return;
    if (gesture.current.mode === "pan") {
      panRef.current = {
        x: gesture.current.panX + (event.clientX - gesture.current.clientX),
        y: gesture.current.panY + (event.clientY - gesture.current.clientY),
      };
      applyView();
      return;
    }
    const point = imagePoint(event);
    if (!point) return;
    if (gesture.current.mode === "draw" && gesture.current.last) {
      paintStroke(gesture.current.last, point);
      gesture.current.last = point;
      return;
    }
    if (gesture.current.mode === "shape" && gesture.current.start) {
      drawRectPreview(previewRef.current, gesture.current.start, point);
      return;
    }
    if (gesture.current.mode === "lasso") {
      gesture.current.points.push(point);
      drawLassoPreview(previewRef.current, gesture.current.points);
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current.pointer !== event.pointerId) return;
    const mask = props.maskRef.current;
    if (gesture.current.mode === "shape" && mask && gesture.current.start) {
      const point = imagePoint(event) ?? gesture.current.start;
      fillRect(mask, gesture.current.start.x, gesture.current.start.y, point.x, point.y);
      redrawOverlay(overlayRef.current, mask, props.showMask);
    }
    if (gesture.current.mode === "lasso" && mask) {
      fillPolygon(mask, gesture.current.points);
      redrawOverlay(overlayRef.current, mask, props.showMask);
    }
    clearCanvas(previewRef.current);
    if (gesture.current.before && (gesture.current.mode === "draw" || gesture.current.mode === "shape" || gesture.current.mode === "lasso")) {
      props.onStrokeCommit(gesture.current.before);
    }
    gesture.current.mode = null;
    gesture.current.before = null;
    gesture.current.last = null;
    gesture.current.pointer = null;
    gesture.current.points = [];
  }

  function onSplitPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    gesture.current.mode = "split";
    gesture.current.pointer = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onSplitPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (gesture.current.mode !== "split" || gesture.current.pointer !== event.pointerId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    props.onSplitRatio(clamp((event.clientX - rect.left) / rect.width, 0.04, 0.96));
  }

  const cursor = props.spacePan || props.tool === "pan" ? "cursor-grab" : props.tool === "rect" || props.tool === "lasso" ? "cursor-cross" : "cursor-none";

  return (
    <div
      className={`viewport ${cursor}`}
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="world" ref={worldRef}>
        <img src={props.originalUrl} alt="" draggable={false} />
        <img
          src={props.imageUrl}
          alt="Photograph being edited"
          draggable={false}
          style={{
            opacity: props.compare && !props.split ? 0 : 1,
            clipPath: props.split ? `inset(0 0 0 ${props.splitRatio * 100}%)` : undefined,
          }}
        />
        <canvas ref={overlayRef} width={props.width} height={props.height} aria-hidden="true" />
        <canvas ref={previewRef} width={props.width} height={props.height} aria-hidden="true" />
      </div>
      {props.split ? (
        <button
          type="button"
          className="split-handle"
          style={{ left: `${props.splitRatio * 100}%` }}
          aria-label="Drag to compare original and edit"
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={() => {
            gesture.current.mode = null;
          }}
        />
      ) : null}
    </div>
  );
});

function redrawOverlay(canvas: HTMLCanvasElement | null, mask: Mask | null, show: boolean) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!show || !mask) return;
  paintMaskRect(context, mask, 0, 0, mask.width, mask.height);
}

function paintMaskRect(
  context: CanvasRenderingContext2D | null,
  mask: Mask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  if (!context) return;
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const right = Math.min(mask.width, Math.ceil(Math.max(x0, x1)));
  const bottom = Math.min(mask.height, Math.ceil(Math.max(y0, y1)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = mask.data[(top + y) * mask.width + left + x];
      const offset = (y * width + x) * 4;
      if (value === 0) continue;
      image.data[offset] = 232;
      image.data[offset + 1] = 186;
      image.data[offset + 2] = 122;
      image.data[offset + 3] = Math.round(value * 0.5);
    }
  }
  context.putImageData(image, left, top);
}

function drawRectPreview(canvas: HTMLCanvasElement | null, start: Point, end: Point) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(243, 239, 230, 0.9)";
  context.lineWidth = Math.max(1, canvas.width / 800);
  context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
}

function drawLassoPreview(canvas: HTMLCanvasElement | null, points: Point[]) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context || points.length < 2) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.strokeStyle = "rgba(243, 239, 230, 0.9)";
  context.lineWidth = Math.max(1, canvas.width / 800);
  context.stroke();
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
