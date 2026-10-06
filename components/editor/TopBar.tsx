import { useEffect, useRef, useState } from "react";
import type { Version } from "@/lib/editor/types";
import { IconRedo, IconUndo } from "./icons";

type TopBarProps = {
  name: string;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  compare: boolean;
  split: boolean;
  status: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onCompareStart: () => void;
  onCompareEnd: () => void;
  onToggleSplit: () => void;
  onFit: () => void;
  onActual: () => void;
  onNew: () => void;
  onExport: (format: "png" | "jpeg" | "webp") => void;
};

export function TopBar(props: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  return (
    <header className="topbar">
      <div className="brand-block">
        <p className="brand">PixelShift</p>
        <p className="filename" title={props.name}>
          {props.name}
        </p>
      </div>
      <div className="top-actions">
        <button type="button" aria-label="Undo" title="Undo (⌘Z)" onClick={props.onUndo} disabled={!props.canUndo}>
          <IconUndo />
        </button>
        <button type="button" aria-label="Redo" title="Redo (⌘⇧Z)" onClick={props.onRedo} disabled={!props.canRedo}>
          <IconRedo />
        </button>
        <span className="divider" aria-hidden="true" />
        <button
          type="button"
          className={props.compare ? "is-on" : ""}
          title="Hold to compare with the original"
          aria-pressed={props.compare}
          onPointerDown={props.onCompareStart}
          onPointerUp={props.onCompareEnd}
          onPointerLeave={props.onCompareEnd}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") props.onCompareStart();
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") props.onCompareEnd();
          }}
        >
          Compare
        </button>
        <button type="button" className={props.split ? "is-on" : ""} aria-pressed={props.split} onClick={props.onToggleSplit}>
          Split
        </button>
        <span className="divider" aria-hidden="true" />
        <button type="button" onClick={props.onFit} title="Fit (0)">
          Fit
        </button>
        <button type="button" onClick={props.onActual} title="100% (1)">
          {props.zoom}%
        </button>
      </div>
      <div className="top-end">
        <p className="status" role="status" aria-live="polite">
          {props.status}
        </p>
        <button type="button" onClick={props.onNew}>
          New photo
        </button>
        <div className="menu" ref={exportRef}>
          <button
            type="button"
            className="primary"
            aria-expanded={exportOpen}
            aria-haspopup="menu"
            onClick={() => setExportOpen((open) => !open)}
          >
            Export
          </button>
          {exportOpen ? (
            <div className="menu-list" role="menu">
              {(["png", "jpeg", "webp"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false);
                    props.onExport(format);
                  }}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function versionIsOriginal(version: Version, versions: Version[]): boolean {
  return versions[0]?.id === version.id;
}
