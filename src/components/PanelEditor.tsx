import { useEffect, useRef, useState } from "react";
import type { Cutout, Panel } from "../pricing";
import { formatNZD } from "../pricing";
import {
  findSpecies,
  MAX_LENGTH_MM,
  MAX_QUANTITY,
  MAX_WIDTH_MM,
  MIN_LENGTH_MM,
  MIN_QUANTITY,
  MIN_THICKNESS_MM,
  MIN_WIDTH_MM,
  type SpeciesId,
} from "../species";
import {
  cutoutsOverlap,
  defaultCutoutDims,
  newId,
} from "../state";

interface Props {
  panels: Panel[];
  species: SpeciesId;
  freshId: string | null;
  /**
   * Per-panel line price (incl GST, × quantity) keyed by panel id.
   * Sourced from priceQuote() so editor-level numbers always match the
   * sticky-bar total under the current finish + overhead split.
   */
  priceByPanelId: Record<string, number>;
  onUpdate: (id: string, next: Panel) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onCutoutChange: (panelId: string, cutoutId: string, updates: Partial<Cutout>) => void;
}

export function PanelEditor({
  panels, species, freshId, priceByPanelId, onUpdate, onRemove, onAdd, onCutoutChange,
}: Props) {
  return (
    <section className="panel-editor" aria-labelledby="panel-editor-h">
      <header className="panel-editor__head">
        <h2 id="panel-editor-h">Panels</h2>
        <span className="panel-editor__count">
          {(() => {
            const units = panels.reduce(
              (s, p) => s + Math.max(1, Math.floor(p.quantity) || 1),
              0,
            );
            return `${units} ${units === 1 ? "piece" : "pieces"}`;
          })()}
        </span>
      </header>
      <ul className="panel-editor__list" role="list">
        {panels.map((p) => (
          <PanelRow
            key={p.id}
            panel={p}
            species={species}
            fresh={p.id === freshId}
            canRemove={panels.length > 1}
            lineTotal={priceByPanelId[p.id] ?? 0}
            onUpdate={(next) => onUpdate(p.id, next)}
            onRemove={() => onRemove(p.id)}
            onCutoutChange={(cutoutId, updates) => onCutoutChange(p.id, cutoutId, updates)}
          />
        ))}
      </ul>
      <button type="button" className="btn-ghost panel-editor__add" onClick={onAdd}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Add another panel
      </button>
      <p className="cutout-list__hint panel-editor__floor-hint">
        Each quote needs one benchtop (1200 × 250 × 20 mm or larger).
        Narrow shelves and offcuts can be added alongside, down to 300 × 250 × 20 mm.
      </p>
    </section>
  );
}

interface RowProps {
  panel: Panel;
  species: SpeciesId;
  fresh: boolean;
  canRemove: boolean;
  lineTotal: number;
  onUpdate: (next: Panel) => void;
  onRemove: () => void;
  onCutoutChange: (cutoutId: string, updates: Partial<Cutout>) => void;
}

type DimKey = "length" | "width" | "thickness" | "quantity";

function PanelRow({
  panel, species, fresh, canRemove, lineTotal, onUpdate, onRemove, onCutoutChange,
}: RowProps) {
  const speciesObj = findSpecies(species);
  const maxThickness = speciesObj.maxThicknessMm;
  const speciesName = speciesObj.name;
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fresh) labelRef.current?.focus();
  }, [fresh]);

  const [warnings, setWarnings] = useState<Partial<Record<DimKey, string>>>({});
  const setWarn = (k: DimKey, msg: string | null) =>
    setWarnings((w) => {
      if (!msg) {
        if (!(k in w)) return w;
        const { [k]: _omit, ...rest } = w;
        void _omit;
        return rest;
      }
      if (w[k] === msg) return w;
      return { ...w, [k]: msg };
    });

  // When species switches and the App-level clamp drops thickness, surface
  // the same hint the user would see if they'd typed an over-cap value.
  const prevSpeciesRef = useRef(species);
  const prevThicknessRef = useRef(panel.thickness);
  useEffect(() => {
    const speciesChanged = prevSpeciesRef.current !== species;
    const thicknessDropped = panel.thickness < prevThicknessRef.current;
    if (speciesChanged && thicknessDropped) {
      setWarn(
        "thickness",
        `Max thickness for ${speciesName} is ${maxThickness} mm — adjusted.`,
      );
    }
    prevSpeciesRef.current = species;
    prevThicknessRef.current = panel.thickness;
  }, [species, panel.thickness, maxThickness, speciesName]);

  const commitDim = (k: DimKey, raw: number) => {
    const bounds = dimBounds(k, maxThickness, speciesName);
    const clamped = Math.max(bounds.min, Math.min(bounds.max, raw));
    if (raw > bounds.max) {
      setWarn(k, bounds.overMsg);
    } else if (raw < bounds.min) {
      setWarn(k, bounds.underMsg);
    } else {
      setWarn(k, null);
    }
    if (clamped !== panel[k]) onUpdate({ ...panel, [k]: clamped });
  };

  const removeCutout = (id: string) =>
    onUpdate({ ...panel, cutouts: panel.cutouts.filter((c) => c.id !== id) });

  return (
    <li className={`panel-row${fresh ? " is-fresh" : ""}`}>
      <div className="panel-row__top">
        <input
          ref={labelRef}
          className="panel-row__label"
          value={panel.label}
          placeholder="Name this piece (optional)"
          onChange={(e) => onUpdate({ ...panel, label: e.target.value })}
        />
        <div className="panel-row__subtotal" aria-label="Cost for this panel">
          <span className="panel-row__subtotal-label">This panel</span>
          <span className="panel-row__subtotal-value">{formatNZD(lineTotal)}</span>
        </div>
        {canRemove && (
          <button
            type="button"
            className="panel-row__remove"
            aria-label={`Remove ${panel.label || "panel"}`}
            onClick={onRemove}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="panel-row__dims">
        <NumField
          label="Length"
          unit="mm"
          value={panel.length}
          min={MIN_LENGTH_MM}
          max={MAX_LENGTH_MM}
          step={10}
          warning={warnings.length}
          onCommit={(n) => commitDim("length", n)}
        />
        <NumField
          label="Width"
          unit="mm"
          value={panel.width}
          min={MIN_WIDTH_MM}
          max={MAX_WIDTH_MM}
          step={10}
          warning={warnings.width}
          onCommit={(n) => commitDim("width", n)}
        />
        <NumField
          label="Thickness"
          unit="mm"
          value={panel.thickness}
          min={MIN_THICKNESS_MM}
          max={maxThickness}
          step={1}
          warning={warnings.thickness}
          onCommit={(n) => commitDim("thickness", n)}
        />
        <NumField
          label="Qty"
          value={panel.quantity}
          min={MIN_QUANTITY}
          max={MAX_QUANTITY}
          step={1}
          warning={warnings.quantity}
          onCommit={(n) => commitDim("quantity", n)}
        />
      </div>

      <div className="panel-row__cutouts">
        <Stepper
          label="Cutouts"
          value={panel.cutouts.length}
          min={0}
          max={3}
          onChange={(n) => {
            const current = panel.cutouts.length;
            if (n > current) {
              onUpdate({ ...panel, cutouts: addCutout(panel) });
            } else if (n < current) {
              onUpdate({ ...panel, cutouts: panel.cutouts.slice(0, n) });
            }
          }}
        />
      </div>

      {panel.cutouts.length > 0 && (
        <ul className="cutout-list" role="list">
          {panel.cutouts.map((c, i) => (
            <CutoutDetail
              key={c.id}
              index={i}
              total={panel.cutouts.length}
              cutout={c}
              panel={panel}
              onChange={(updates) => onCutoutChange(c.id, updates)}
              onRemove={() => removeCutout(c.id)}
            />
          ))}
          <li className="cutout-list__hint">
            Drag any cutout on the preview to reposition it. Use the inputs for exact values.
          </li>
        </ul>
      )}
    </li>
  );
}

interface CutoutDetailProps {
  index: number;
  total: number;
  cutout: Cutout;
  panel: Panel;
  onChange: (updates: Partial<Cutout>) => void;
  onRemove: () => void;
}

function CutoutDetail({
  index, total, cutout, panel, onChange, onRemove,
}: CutoutDetailProps) {
  const fromLeft = Math.round(cutout.pos * panel.length - cutout.widthMm / 2);
  const fromFront = Math.round(cutout.cross * panel.width - cutout.depthMm / 2);

  const maxW = Math.max(50, panel.length - 20);
  const maxD = Math.max(50, panel.width - 20);

  const setWidth = (w: number) => {
    const next = clamp(w, 50, maxW);
    const nextPos = clamp((fromLeft + next / 2) / panel.length, 0, 1);
    onChange({ widthMm: next, pos: nextPos });
  };
  const setDepth = (d: number) => {
    const next = clamp(d, 50, maxD);
    const nextCross = clamp((fromFront + next / 2) / panel.width, 0, 1);
    onChange({ depthMm: next, cross: nextCross });
  };
  const setFromLeft = (mm: number) => {
    const clamped = clamp(mm, 0, Math.max(0, panel.length - cutout.widthMm));
    const nextPos = (clamped + cutout.widthMm / 2) / panel.length;
    onChange({ pos: nextPos });
  };
  const setFromFront = (mm: number) => {
    const clamped = clamp(mm, 0, Math.max(0, panel.width - cutout.depthMm));
    const nextCross = (clamped + cutout.depthMm / 2) / panel.width;
    onChange({ cross: nextCross });
  };

  return (
    <li className="cutout-item">
      <div className="cutout-item__head">
        <span className="cutout-item__label">
          Cutout {index + 1}
          {total > 1 ? <em> of {total}</em> : null}
        </span>
        <button
          type="button"
          className="cutout-item__remove"
          aria-label={`Remove cutout ${index + 1}`}
          onClick={onRemove}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="cutout-item__grid">
        <NumField label="Width" unit="mm" value={cutout.widthMm} min={50} max={maxW} step={10} onCommit={setWidth} />
        <NumField label="Depth" unit="mm" value={cutout.depthMm} min={50} max={maxD} step={10} onCommit={setDepth} />
        <NumField label="From left" unit="mm" value={fromLeft} min={0} max={Math.max(0, panel.length - cutout.widthMm)} step={5} onCommit={setFromLeft} />
        <NumField label="From front" unit="mm" value={fromFront} min={0} max={Math.max(0, panel.width - cutout.depthMm)} step={5} onCommit={setFromFront} />
      </div>
    </li>
  );
}

function addCutout(panel: Panel): Cutout[] {
  const sorted = panel.cutouts.map((c) => c.pos).sort((a, b) => a - b);
  const points = [0, ...sorted, 1];
  let bestGap = -1;
  let bestMid = 0.5;
  for (let i = 0; i < points.length - 1; i++) {
    const g = points[i + 1] - points[i];
    if (g > bestGap) {
      bestGap = g;
      bestMid = (points[i] + points[i + 1]) / 2;
    }
  }
  // Cap the default dims to whatever actually fits inside this panel. If
  // the panel was resized smaller than the configured defaults (400 × 500),
  // shrink the new cutout accordingly — with a 20mm margin from each edge.
  const d = defaultCutoutDims();
  const maxW = Math.max(50, panel.length - 20);
  const maxD = Math.max(50, panel.width - 20);
  const baseW = Math.min(d.widthMm, maxW);
  const baseD = Math.min(d.depthMm, maxD);

  // Look for a non-overlapping slot. Prefer the default size at the largest
  // X gap, centre-cross. If that's blocked, try other cross positions; if
  // still blocked, shrink the new cutout until it fits. Bail out gracefully
  // if nothing fits so we never return an overlapping cutout.
  const crossCandidates = [0.5, 0.3, 0.7, 0.2, 0.8];
  const sizeFactors = [1.0, 0.75, 0.55, 0.4];
  for (const factor of sizeFactors) {
    const widthMm = Math.max(50, baseW * factor);
    const depthMm = Math.max(50, baseD * factor);
    const halfW = widthMm / 2 / panel.length;
    const halfD = depthMm / 2 / panel.width;
    const pos = Math.max(halfW, Math.min(1 - halfW, bestMid));
    for (const c of crossCandidates) {
      const cross = Math.max(halfD, Math.min(1 - halfD, c));
      const candidate: Cutout = { id: newId(), pos, cross, widthMm, depthMm };
      const overlaps = panel.cutouts.some((o) =>
        cutoutsOverlap(candidate, o, panel.length, panel.width),
      );
      if (!overlaps) return [...panel.cutouts, candidate];
    }
  }
  // No room for another cutout at any reasonable size — leave the panel alone.
  return panel.cutouts;
}

// Per-dimension bounds + the messages that render when the user types
// outside them. Thickness pulls its cap and species name from the row,
// so the message reads naturally ("Max thickness for Rimu is 33 mm").
function dimBounds(
  k: DimKey,
  maxThickness: number,
  speciesName: string,
): { min: number; max: number; underMsg: string; overMsg: string } {
  switch (k) {
    case "length":
      return {
        min: MIN_LENGTH_MM, max: MAX_LENGTH_MM,
        underMsg: `Min length is ${MIN_LENGTH_MM} mm — adjusted.`,
        overMsg: `Max length is ${MAX_LENGTH_MM} mm — adjusted.`,
      };
    case "width":
      return {
        min: MIN_WIDTH_MM, max: MAX_WIDTH_MM,
        underMsg: `Min width is ${MIN_WIDTH_MM} mm — adjusted.`,
        overMsg: `Max width is ${MAX_WIDTH_MM} mm — adjusted.`,
      };
    case "thickness":
      return {
        min: MIN_THICKNESS_MM, max: maxThickness,
        underMsg: `Min thickness is ${MIN_THICKNESS_MM} mm — adjusted.`,
        overMsg: `Max thickness for ${speciesName} is ${maxThickness} mm — adjusted.`,
      };
    case "quantity":
      return {
        min: MIN_QUANTITY, max: MAX_QUANTITY,
        underMsg: `Min quantity is ${MIN_QUANTITY} — adjusted.`,
        overMsg: `Max quantity is ${MAX_QUANTITY} — adjusted.`,
      };
  }
}

// ─── NumField: transient text during editing, commit on blur/Enter ────────

function NumField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  hint,
  warning,
  onCommit,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional helper text appended after the unit, e.g. "max for Rimu". */
  hint?: string;
  /** Inline warning rendered under the input (e.g. "Max length is 4500 mm — adjusted."). */
  warning?: string;
  /** Receives the rounded raw number the user committed; clamping + hint
   *  state live in the parent so out-of-range entries can be surfaced. */
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(() => String(value));
  const focusedRef = useRef(false);

  // Only sync prop → input when the field is NOT focused.
  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    onCommit(Math.round(n));
  };

  return (
    <label className="numfield">
      <span className="numfield__label">
        {label}
        {unit ? <em> ({unit})</em> : null}
        {hint ? <em className="numfield__hint"> · {hint}</em> : null}
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        aria-invalid={warning ? true : undefined}
        value={text}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          const v = e.target.value;
          // Allow empty string + digits while editing
          if (/^[-]?\d{0,5}$/.test(v) || v === "") setText(v);
        }}
        onBlur={() => { focusedRef.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = e.key === "ArrowUp" ? step : -step;
            const next = clamp((Number(text) || value) + delta, min, max);
            setText(String(next));
            onCommit(next);
          }
        }}
      />
      {warning ? (
        <span className="numfield__warning" role="status">{warning}</span>
      ) : null}
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper__label">{label}</span>
      <div className="stepper__controls">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1, min, max))}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="stepper__value" aria-live="polite">{value}</span>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1, min, max))}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
