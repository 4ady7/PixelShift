import type { EditMode, Tool, VariantState, Version } from "@/lib/editor/types";

const LOOKS = [
  { label: "Cinematic", instruction: "Make this a cinematic photograph with controlled contrast and natural colour." },
  { label: "Editorial", instruction: "Make this look like a luxury fashion editorial, keeping the same people, place, and framing." },
  { label: "Golden hour", instruction: "Make the lighting feel like golden hour." },
  { label: "Daylight", instruction: "Make the lighting clean natural daylight." },
  { label: "Night", instruction: "Turn this into a cinematic night photograph." },
  { label: "Rain", instruction: "Add realistic rain while keeping the same place and composition." },
  { label: "35mm", instruction: "Give the whole photograph a 35mm film aesthetic." },
  { label: "Documentary", instruction: "Make this feel like a documentary photograph." },
];

type EditDockProps = {
  mode: EditMode;
  tool: Tool;
  prompt: string;
  brushSize: number;
  brushSoftness: number;
  edgeRadius: number;
  showMask: boolean;
  hasSelection: boolean;
  busy: boolean;
  error: string | null;
  versions: Version[];
  currentId: string | null;
  variants: VariantState[];
  onMode: (mode: EditMode) => void;
  onTool: (tool: Tool) => void;
  onPrompt: (prompt: string) => void;
  onBrushSize: (size: number) => void;
  onBrushSoftness: (softness: number) => void;
  onEdgeRadius: (radius: number) => void;
  onToggleMask: () => void;
  onInvert: () => void;
  onExpand: () => void;
  onContract: () => void;
  onFeather: () => void;
  onClear: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onApply: (variant: VariantState) => void;
  onRetry: (variant: VariantState) => void;
  onSelectVersion: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

export function EditDock(props: EditDockProps) {
  const placeholder =
    props.mode === "render"
      ? "Make the lighting feel like golden hour"
      : props.mode === "prompt"
        ? "Remove the person standing behind me"
        : props.hasSelection
          ? "What should this area become?"
          : "Select an area, then describe the change";
  const note =
    props.mode === "select"
      ? "Only the selected area is replaced. Everything else stays as it is."
      : "This can change the whole photograph. Compare it with the original before you keep it.";

  return (
    <section className="dock" aria-label="Edit controls">
      <div className="versions" role="list" aria-label="Versions">
        {props.versions.map((version) => {
          const current = version.id === props.currentId;
          const original = props.versions[0]?.id === version.id;
          return (
            <div key={version.id} className={current ? "version is-current" : "version"} role="listitem">
              <button type="button" onClick={() => props.onSelectVersion(version.id)} aria-current={current ? "true" : undefined}>
                <img src={version.url} alt="" />
                <span>{version.label}</span>
              </button>
              {current && !original ? (
                <span className="version-actions">
                  <button type="button" disabled={props.busy} onClick={() => props.onDuplicate(version.id)}>
                    Duplicate
                  </button>
                  <button type="button" disabled={props.busy} onClick={() => props.onDelete(version.id)}>
                    Delete
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="modes" role="tablist" aria-label="Edit mode">
        {(
          [
            ["select", "Select & edit"],
            ["prompt", "Prompt"],
            ["render", "Render"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={props.mode === mode}
            className={props.mode === mode ? "is-on" : ""}
            onClick={() => props.onMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      {props.mode === "select" ? (
        <div className="tools">
          <div className="tool-row" role="toolbar" aria-label="Selection tools">
            <ToolButton label="Brush" shortcut="B" pressed={props.tool === "brush"} onClick={() => props.onTool("brush")} />
            <ToolButton label="Erase" shortcut="E" pressed={props.tool === "erase"} onClick={() => props.onTool("erase")} />
            <ToolButton label="Rectangle" shortcut="R" pressed={props.tool === "rect"} onClick={() => props.onTool("rect")} />
            <ToolButton label="Lasso" shortcut="L" pressed={props.tool === "lasso"} onClick={() => props.onTool("lasso")} />
            <ToolButton label="Move" shortcut="V" pressed={props.tool === "pan"} onClick={() => props.onTool("pan")} />
          </div>
          <label className="slider">
            Size
            <input
              type="range"
              min={4}
              max={240}
              value={props.brushSize}
              aria-valuetext={`${props.brushSize} pixels`}
              onChange={(event) => props.onBrushSize(Number(event.target.value))}
            />
          </label>
          <label className="slider">
            Softness
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(props.brushSoftness * 100)}
              aria-valuetext={`${Math.round(props.brushSoftness * 100)} percent`}
              onChange={(event) => props.onBrushSoftness(Number(event.target.value) / 100)}
            />
          </label>
          <div className="tool-row">
            <button type="button" onClick={props.onInvert} disabled={!props.hasSelection}>
              Invert
            </button>
            <button type="button" onClick={props.onExpand} disabled={!props.hasSelection}>
              Expand
            </button>
            <button type="button" onClick={props.onContract} disabled={!props.hasSelection}>
              Contract
            </button>
            <button type="button" onClick={props.onFeather} disabled={!props.hasSelection}>
              Feather
            </button>
            <button type="button" onClick={props.onClear} disabled={!props.hasSelection}>
              Clear
            </button>
            <button type="button" aria-pressed={props.showMask} onClick={props.onToggleMask}>
              {props.showMask ? "Hide selection" : "Show selection"}
            </button>
            <label className="edge">
              Edge
              <input
                type="number"
                min={1}
                max={64}
                value={props.edgeRadius}
                onChange={(event) => props.onEdgeRadius(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
      ) : null}

      {props.mode === "render" ? (
        <div className="looks" role="list" aria-label="Render looks">
          {LOOKS.map((look) => (
            <button key={look.label} type="button" onClick={() => props.onPrompt(look.instruction)}>
              {look.label}
            </button>
          ))}
        </div>
      ) : null}

      <label className="prompt">
        <span className="sr-only">What should change?</span>
        <textarea
          rows={2}
          value={props.prompt}
          placeholder={placeholder}
          disabled={props.busy}
          onChange={(event) => props.onPrompt(event.target.value)}
        />
      </label>
      <div className="generate-row">
        <p>{note}</p>
        {props.busy ? (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        ) : (
          <button className="primary" type="button" onClick={props.onGenerate}>
            Generate
          </button>
        )}
      </div>
      {props.error ? (
        <p className="alert" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.variants.length > 0 ? (
        <div className="variants" role="list" aria-label="Variations">
          {props.variants.map((variant) => (
            <article key={variant.id} role="listitem">
              <button type="button" aria-label={`Use ${variant.label}`} disabled={!variant.url || props.busy} onClick={() => props.onApply(variant)}>
                {variant.url ? <img src={variant.url} alt="" /> : <span>{variant.status === "error" ? "Failed" : "Generating"}</span>}
              </button>
              <p>{variant.label}</p>
              {variant.error && variant.error !== props.error ? <p className="variant-error">{variant.error}</p> : null}
              {variant.status === "error" && !props.busy ? (
                <button type="button" onClick={() => props.onRetry(variant)}>
                  Retry
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ToolButton({
  label,
  shortcut,
  pressed,
  onClick,
}: {
  label: string;
  shortcut: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={pressed ? "is-on" : ""} aria-pressed={pressed} aria-keyshortcuts={shortcut} title={`${label} (${shortcut})`} onClick={onClick}>
      {label}
    </button>
  );
}
