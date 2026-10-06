"use client";

import { useEffect, useRef, useState } from "react";
import { EditHistory } from "@/lib/editor/history";
import type { EditMode, Tool, VariantState, Variation, Version } from "@/lib/editor/types";
import { MAX_INSTRUCTION } from "@/lib/image/limits";
import {
  createMask,
  dilate,
  erode,
  feather,
  invertMask,
  maskHasSelection,
  masksEqual,
  maskToPngBlob,
  type Mask,
} from "@/lib/mask/mask";
import { CanvasStage, type StageHandle } from "./CanvasStage";
import { EditDock } from "./EditDock";
import { EmptyState } from "./EmptyState";
import { downloadBlob, downloadPhotograph, exportFilename, imageUrlToBlob, readPhotographFile } from "./photo-files";
import { TopBar } from "./TopBar";

const VARIATIONS: { id: Variation; label: string }[] = [
  { id: "conservative", label: "Conservative" },
  { id: "balanced", label: "Balanced" },
  { id: "creative", label: "Creative" },
];

type Snapshot = { mask: Uint8Array; versionId: string };
type Photo = { name: string; width: number; height: number; file: File };

export function Editor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<StageHandle>(null);
  const maskRef = useRef<Mask | null>(null);
  const historyRef = useRef(new EditHistory<Snapshot>());
  const editCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const jobRef = useRef<{ image: Blob; mask: Blob | null; instruction: string; mode: EditMode } | null>(null);

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>("select");
  const [tool, setTool] = useState<Tool>("brush");
  const [prompt, setPrompt] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [brushSoftness, setBrushSoftness] = useState(0.35);
  const [edgeRadius, setEdgeRadius] = useState(12);
  const [showMask, setShowMask] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const [maskRevision, setMaskRevision] = useState(0);
  const [historyTick, setHistoryTick] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [spacePan, setSpacePan] = useState(false);
  const [status, setStatus] = useState<"idle" | "preparing" | "generating" | "complete" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantState[]>([]);

  const current = versions.find((version) => version.id === currentId) ?? versions[0] ?? null;
  const original = versions[0] ?? null;
  const busy = status === "preparing" || status === "generating";

  useEffect(() => {
    if (versions.length < 2) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [versions.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (current) void exportCurrent("png");
        return;
      }
      if (event.code === "Space") {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!photo || target?.closest("button, a, input, textarea")) return;
        event.preventDefault();
        setSpacePan(true);
        return;
      }
      if (event.key === "\\") setCompare(true);
      const key = event.key.toLowerCase();
      if (key === "b") setTool("brush");
      if (key === "e") setTool("erase");
      if (key === "r") setTool("rect");
      if (key === "l") setTool("lasso");
      if (key === "v") setTool("pan");
      if (key === "[") setBrushSize((size) => Math.max(4, size - 8));
      if (key === "]") setBrushSize((size) => Math.min(240, size + 8));
      if (key === "0") stageRef.current?.fit();
      if (key === "1") stageRef.current?.actualSize();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePan(false);
      if (event.key === "\\") setCompare(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  function bumpHistory() {
    setHistoryTick((tick) => tick + 1);
  }

  function remember(change: (mask: Mask) => void) {
    const mask = maskRef.current;
    if (!mask || !currentId) return;
    const before = mask.data.slice();
    change(mask);
    if (masksEqual(before, mask.data)) return;
    historyRef.current.push({ mask: before, versionId: currentId });
    setHasSelection(maskHasSelection(mask));
    setMaskRevision((revision) => revision + 1);
    bumpHistory();
  }

  function restore(snapshot: Snapshot) {
    const mask = maskRef.current;
    if (!mask || snapshot.mask.length !== mask.data.length) return;
    mask.data.set(snapshot.mask);
    setCurrentId(snapshot.versionId);
    setHasSelection(maskHasSelection(mask));
    setMaskRevision((revision) => revision + 1);
    bumpHistory();
  }

  function undo() {
    if (!currentId || !maskRef.current) return;
    const previous = historyRef.current.undo({ mask: maskRef.current.data.slice(), versionId: currentId });
    if (previous) restore(previous);
  }

  function redo() {
    if (!currentId || !maskRef.current) return;
    const next = historyRef.current.redo({ mask: maskRef.current.data.slice(), versionId: currentId });
    if (next) restore(next);
  }

  function revokeVersions(list: Version[], extra: VariantState[] = []) {
    for (const version of list) URL.revokeObjectURL(version.url);
    for (const variant of extra) {
      if (variant.url) URL.revokeObjectURL(variant.url);
    }
  }

  async function openFile(file: File) {
    if (versions.length > 1 && !window.confirm("Replace this photograph? The current edits stay in this tab only until you export them.")) {
      return;
    }
    try {
      const loaded = await readPhotographFile(file);
      revokeVersions(versions, variants);
      abortRef.current?.abort();
      const id = crypto.randomUUID();
      maskRef.current = createMask(loaded.width, loaded.height);
      historyRef.current.clear();
      editCountRef.current = 0;
      setPhoto({ name: loaded.name, width: loaded.width, height: loaded.height, file: loaded.file });
      setVersions([
        {
          id,
          parentId: null,
          label: "Original",
          instruction: null,
          mode: null,
          url: loaded.url,
          createdAt: Date.now(),
        },
      ]);
      setCurrentId(id);
      setHasSelection(false);
      setMaskRevision((revision) => revision + 1);
      bumpHistory();
      setVariants([]);
      setError(null);
      setStatus("idle");
      setCompare(false);
      setSplit(false);
      if (pendingPrompt) setPrompt(pendingPrompt);
      setPendingPrompt(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This photograph couldn't be read.");
    }
  }

  function onStrokeCommit(before: Uint8Array) {
    const mask = maskRef.current;
    if (!mask || !currentId || masksEqual(before, mask.data)) return;
    historyRef.current.push({ mask: before, versionId: currentId });
    setHasSelection(maskHasSelection(mask));
    bumpHistory();
  }

  async function generate() {
    if (!current || !photo) return;
    const instruction = prompt.trim();
    if (!instruction) {
      setError("Describe what should change.");
      return;
    }
    if (instruction.length > MAX_INSTRUCTION) {
      setError("That description is too long. Shorten it and try again.");
      return;
    }
    if (mode === "select" && !hasSelection) {
      setError("Select the area that should change.");
      return;
    }
    setError(null);
    setStatus("preparing");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      const image = await imageUrlToBlob(current.url);
      const mask = mode === "select" && maskRef.current ? await maskToPngBlob(maskRef.current) : null;
      if (generationRef.current !== generation) return;
      jobRef.current = { image, mask, instruction, mode };
      setStatus("generating");
      clearVariantUrls(variants);
      setVariants(VARIATIONS.map((item) => ({ id: item.id, label: item.label, status: "pending", url: null, error: null })));
      const results = await Promise.all(
        VARIATIONS.map((item) => runVariation(item.id, image, mask, instruction, mode, controller.signal, generation)),
      );
      if (generationRef.current !== generation) return;
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      const failures = results.filter((result) => !result.ok);
      if (failures.length === results.length) {
        setStatus("error");
        setError(failures[0]?.message ?? "We couldn't generate this edit.");
        return;
      }
      setStatus("complete");
    } catch (generationError) {
      if (controller.signal.aborted) {
        setStatus("idle");
        setError("Generation cancelled.");
        return;
      }
      setStatus("error");
      setError(generationError instanceof Error ? generationError.message : "We couldn't generate this edit.");
    }
  }

  async function runVariation(
    variation: Variation,
    image: Blob,
    mask: Blob | null,
    instruction: string,
    editMode: EditMode,
    signal: AbortSignal,
    generation: number,
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const form = new FormData();
      form.set("image", image, "photograph.jpg");
      if (mask) form.set("mask", mask, "selection.png");
      form.set("instruction", instruction);
      form.set("mode", editMode);
      form.set("variation", variation);
      const response = await fetch("/api/edits", { method: "POST", body: form, signal });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "We couldn't generate this edit.");
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const matches = photo && bitmap.width === photo.width && bitmap.height === photo.height;
      bitmap.close();
      if (!matches) throw new Error("The result didn't match the photograph's dimensions.");
      const url = URL.createObjectURL(blob);
      if (generationRef.current !== generation) {
        URL.revokeObjectURL(url);
        return { ok: false, message: "Generation cancelled." };
      }
      setVariants((currentVariants) =>
        currentVariants.map((variant) => (variant.id === variation ? { ...variant, status: "ready", url, error: null } : variant)),
      );
      return { ok: true };
    } catch (variationError) {
      if (signal.aborted || generationRef.current !== generation) return { ok: false, message: "Generation cancelled." };
      const message = variationError instanceof Error ? variationError.message : "We couldn't generate this edit.";
      setVariants((currentVariants) =>
        currentVariants.map((variant) => (variant.id === variation ? { ...variant, status: "error", error: message } : variant)),
      );
      return { ok: false, message };
    }
  }

  async function retry(variant: VariantState) {
    const job = jobRef.current;
    if (!job || busy) return;
    setVariants((currentVariants) =>
      currentVariants.map((item) => (item.id === variant.id ? { ...item, status: "pending", error: null } : item)),
    );
    setStatus("generating");
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current;
    await runVariation(variant.id, job.image, job.mask, job.instruction, job.mode, controller.signal, generation);
    setStatus("complete");
  }

  async function applyVariant(variant: VariantState) {
    if (!variant.url || !currentId || !maskRef.current) return;
    const blob = await fetch(variant.url).then((response) => response.blob());
    const url = URL.createObjectURL(blob);
    const before = { mask: maskRef.current.data.slice(), versionId: currentId };
    historyRef.current.push(before);
    editCountRef.current += 1;
    const id = crypto.randomUUID();
    const label = `Edit ${String(editCountRef.current).padStart(2, "0")}`;
    maskRef.current.data.fill(0);
    setVersions((currentVersions) => [
      ...currentVersions,
      {
        id,
        parentId: currentId,
        label,
        instruction: prompt.trim(),
        mode,
        url,
        createdAt: Date.now(),
      },
    ]);
    setCurrentId(id);
    setHasSelection(false);
    setMaskRevision((revision) => revision + 1);
    bumpHistory();
    setError(null);
  }

  function selectVersion(id: string) {
    const mask = maskRef.current;
    if (!mask || !currentId || id === currentId) return;
    historyRef.current.push({ mask: mask.data.slice(), versionId: currentId });
    mask.data.fill(0);
    setCurrentId(id);
    setHasSelection(false);
    setMaskRevision((revision) => revision + 1);
    bumpHistory();
  }

  async function duplicateVersion(id: string) {
    const version = versions.find((item) => item.id === id);
    if (!version) return;
    const blob = await fetch(version.url).then((response) => response.blob());
    const url = URL.createObjectURL(blob);
    if (maskRef.current && currentId) {
      historyRef.current.push({ mask: maskRef.current.data.slice(), versionId: currentId });
      maskRef.current.data.fill(0);
      setHasSelection(false);
      setMaskRevision((revision) => revision + 1);
      bumpHistory();
    }
    editCountRef.current += 1;
    const nextId = crypto.randomUUID();
    setVersions((currentVersions) => [
      ...currentVersions,
      {
        ...version,
        id: nextId,
        parentId: version.id,
        label: `Edit ${String(editCountRef.current).padStart(2, "0")}`,
        url,
        createdAt: Date.now(),
      },
    ]);
    setCurrentId(nextId);
  }

  function deleteVersion(id: string) {
    const version = versions.find((item) => item.id === id);
    if (!version || versions[0]?.id === id) return;
    if (!window.confirm(`Delete ${version.label}?`)) return;
    const parent = versions.some((item) => item.id === version.parentId) ? version.parentId : versions[0].id;
    URL.revokeObjectURL(version.url);
    setVersions((currentVersions) => currentVersions.filter((item) => item.id !== id));
    if (currentId === id && parent) setCurrentId(parent);
  }

  async function exportCurrent(format: "png" | "jpeg" | "webp") {
    if (!current) return;
    const type = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const filename = exportFilename(current.label, format === "jpeg" ? "jpg" : format);
    try {
      if (original && current.id === original.id && photo) {
        const same =
          (format === "jpeg" && photo.file.type === "image/jpeg") ||
          (format === "png" && photo.file.type === "image/png") ||
          (format === "webp" && photo.file.type === "image/webp");
        if (same) {
          downloadBlob(photo.file, filename);
          return;
        }
      }
      await downloadPhotograph(current.url, filename, type);
      setError(null);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export the photograph.");
    }
  }

  const statusText =
    status === "preparing"
      ? "Preparing photograph"
      : status === "generating"
        ? "Generating"
        : status === "complete"
          ? "Choose a result"
          : null;

  return (
    <main
      className={photo ? "workspace" : "workspace is-empty"}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        aria-label="Upload a photograph"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openFile(file);
        }}
      />
      {photo && current && original && maskRef.current ? (
        <>
          <TopBar
            name={photo.name}
            zoom={zoom}
            canUndo={historyRef.current.canUndo}
            canRedo={historyRef.current.canRedo}
            compare={compare}
            split={split}
            status={statusText}
            onUndo={undo}
            onRedo={redo}
            onCompareStart={() => setCompare(true)}
            onCompareEnd={() => setCompare(false)}
            onToggleSplit={() => setSplit((value) => !value)}
            onFit={() => stageRef.current?.fit()}
            onActual={() => stageRef.current?.actualSize()}
            onNew={() => inputRef.current?.click()}
            onExport={(format) => void exportCurrent(format)}
          />
          <div className="stage">
            <CanvasStage
              ref={stageRef}
              imageUrl={current.url}
              originalUrl={original.url}
              viewKey={original.id}
              width={photo.width}
              height={photo.height}
              maskRef={maskRef}
              maskRevision={maskRevision}
              showMask={showMask && mode === "select"}
              compare={compare}
              split={split}
              splitRatio={splitRatio}
              tool={tool}
              spacePan={spacePan}
              brushSize={brushSize}
              brushSoftness={brushSoftness}
              onSplitRatio={setSplitRatio}
              onStrokeCommit={onStrokeCommit}
              onZoomChange={(value) => setZoom(Math.round(value * 100))}
            />
            <EditDock
              mode={mode}
              tool={tool}
              prompt={prompt}
              brushSize={brushSize}
              brushSoftness={brushSoftness}
              edgeRadius={edgeRadius}
              showMask={showMask}
              hasSelection={hasSelection}
              busy={busy}
              error={error}
              versions={versions}
              currentId={currentId}
              variants={variants}
              onMode={setMode}
              onTool={setTool}
              onPrompt={setPrompt}
              onBrushSize={setBrushSize}
              onBrushSoftness={setBrushSoftness}
              onEdgeRadius={(value) => setEdgeRadius(Math.min(64, Math.max(1, Math.round(value) || 1)))}
              onToggleMask={() => setShowMask((value) => !value)}
              onInvert={() => remember(invertMask)}
              onExpand={() => remember((mask) => (mask.data = dilate(mask, edgeRadius)))}
              onContract={() => remember((mask) => (mask.data = erode(mask, edgeRadius)))}
              onFeather={() => remember((mask) => (mask.data = feather(mask, edgeRadius)))}
              onClear={() => remember((mask) => mask.data.fill(0))}
              onGenerate={() => void generate()}
              onCancel={() => abortRef.current?.abort()}
              onApply={(variant) => void applyVariant(variant)}
              onRetry={(variant) => void retry(variant)}
              onSelectVersion={selectVersion}
              onDuplicate={(id) => void duplicateVersion(id)}
              onDelete={deleteVersion}
            />
          </div>
        </>
      ) : (
        <EmptyState
          error={error}
          onUpload={() => inputRef.current?.click()}
          onExample={(nextPrompt) => {
            setPendingPrompt(nextPrompt);
            setPrompt(nextPrompt);
            inputRef.current?.click();
          }}
        />
      )}
      <span className="sr-only" aria-hidden="true">
        {historyTick}
      </span>
    </main>
  );
}

function clearVariantUrls(variants: VariantState[]) {
  for (const variant of variants) {
    if (variant.url) URL.revokeObjectURL(variant.url);
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}
