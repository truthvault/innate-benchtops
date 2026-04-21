import { useMemo, useRef, useState } from "react";
import type { Cutout, Panel } from "../pricing";
import { findSpecies, type FinishId, type SpeciesId } from "../species";
import { Offcut } from "./Offcut";

interface Props {
  panels: Panel[];
  species: SpeciesId;
  finish: FinishId;
  onCutoutChange?: (panelId: string, cutoutId: string, updates: Partial<Cutout>) => void;
}

const VIEW = { w: 1000, h: 356 };
const MARGIN_TOP = 18;
const MARGIN_RIGHT = 20;
const MARGIN_BOTTOM = 14;
const MARGIN_LEFT = 42;
const DIM_RESERVE = 22;
const GAP_MM = 80;

interface Box {
  x: number; y: number; w: number; h: number;
  panel: Panel;
}

interface PlacedCutout {
  cutout: Cutout;
  box: Box;
  rect: { x: number; y: number; w: number; h: number };
  /** distances (mm) from cutout edge to each panel edge */
  dLeft: number;
  dRight: number;
  dTop: number;
  dBottom: number;
}

interface DragState {
  panelId: string;
  cutoutId: string;
  pointerId: number;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

type EditField = "h" | "v" | "w" | "d";
interface EditingState {
  cutoutId: string;
  field: EditField;
}

export function SlabPreview({
  panels, species, finish, onCutoutChange,
}: Props) {
  const sp = findSpecies(species);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);

  const { boxes, scale } = useMemo(() => layout(panels), [panels]);

  const filterId = finish === "raw" ? "url(#finish-raw)" : undefined;

  const commitEdit = (placed: PlacedCutout, field: EditField, raw: string) => {
    if (!onCutoutChange) { setEditing(null); return; }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) { setEditing(null); return; }
    const { cutout, box, dLeft, dRight, dTop, dBottom } = placed;
    const panel = box.panel;
    const hNearLeft = dLeft <= dRight;
    const vNearTop = dTop <= dBottom;

    switch (field) {
      case "h": {
        // Distance from the near horizontal edge.
        const maxDist = Math.max(0, panel.length - cutout.widthMm);
        const dist = clamp(n, 0, maxDist);
        const fromLeft = hNearLeft ? dist : panel.length - dist - cutout.widthMm;
        const nextPos = clamp((fromLeft + cutout.widthMm / 2) / panel.length, 0, 1);
        onCutoutChange(panel.id, cutout.id, { pos: nextPos });
        break;
      }
      case "v": {
        const maxDist = Math.max(0, panel.width - cutout.depthMm);
        const dist = clamp(n, 0, maxDist);
        const fromTop = vNearTop ? dist : panel.width - dist - cutout.depthMm;
        const nextCross = clamp((fromTop + cutout.depthMm / 2) / panel.width, 0, 1);
        onCutoutChange(panel.id, cutout.id, { cross: nextCross });
        break;
      }
      case "w": {
        // Resize the cutout width while keeping its left edge roughly fixed.
        const currFromLeft = cutout.pos * panel.length - cutout.widthMm / 2;
        const maxW = Math.max(50, panel.length - 20);
        const next = clamp(n, 50, maxW);
        const nextPos = clamp((currFromLeft + next / 2) / panel.length, 0, 1);
        onCutoutChange(panel.id, cutout.id, { widthMm: next, pos: nextPos });
        break;
      }
      case "d": {
        const currFromTop = cutout.cross * panel.width - cutout.depthMm / 2;
        const maxD = Math.max(50, panel.width - 20);
        const next = clamp(n, 50, maxD);
        const nextCross = clamp((currFromTop + next / 2) / panel.width, 0, 1);
        onCutoutChange(panel.id, cutout.id, { depthMm: next, cross: nextCross });
        break;
      }
    }
    setEditing(null);
  };

  const pointerToPanel = (e: React.PointerEvent, box: Box, cutout: Cutout) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const halfLong = cutout.widthMm / 2 / box.panel.length;
    const halfShort = cutout.depthMm / 2 / box.panel.width;
    const pos = clamp((local.x - box.x) / box.w, halfLong, 1 - halfLong);
    const cross = clamp((local.y - box.y) / box.h, halfShort, 1 - halfShort);
    return { pos, cross };
  };

  const onCutoutPointerDown = (
    e: React.PointerEvent<SVGGElement>,
    box: Box,
    cutout: Cutout,
  ) => {
    if (!onCutoutChange) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      panelId: box.panel.id,
      cutoutId: cutout.id,
      pointerId: e.pointerId,
    };
  };

  const onCutoutPointerMove = (
    e: React.PointerEvent<SVGGElement>,
    box: Box,
    cutout: Cutout,
  ) => {
    const d = dragRef.current;
    if (!d || d.cutoutId !== cutout.id || !onCutoutChange) return;
    const next = pointerToPanel(e, box, cutout);
    if (!next) return;
    onCutoutChange(box.panel.id, cutout.id, { pos: next.pos, cross: next.cross });
  };

  const onCutoutPointerEnd = (
    e: React.PointerEvent<SVGGElement>,
    _box: Box,
    cutout: Cutout,
  ) => {
    const d = dragRef.current;
    if (!d || d.cutoutId !== cutout.id) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };

  const onCutoutKeyDown = (
    e: React.KeyboardEvent<SVGGElement>,
    box: Box,
    cutout: Cutout,
  ) => {
    if (!onCutoutChange) return;
    const step = e.shiftKey ? 0.1 : 0.01;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowDown") dy = step;
    else if (e.key === "ArrowUp") dy = -step;
    else return;
    e.preventDefault();
    const halfLong = cutout.widthMm / 2 / box.panel.length;
    const halfShort = cutout.depthMm / 2 / box.panel.width;
    const nextPos = clamp(cutout.pos + dx, halfLong, 1 - halfLong);
    const nextCross = clamp(cutout.cross + dy, halfShort, 1 - halfShort);
    onCutoutChange(box.panel.id, cutout.id, { pos: nextPos, cross: nextCross });
  };

  return (
    <div
      className="slab-preview"
      aria-label={`Top-down preview: ${panels.length} panel(s) in ${sp.name}`}
    >
      <svg ref={svgRef} viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" role="img">
        <defs>
          <filter id="finish-raw" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values="
                0.78 0.15 0.07 0 0.02
                0.15 0.78 0.07 0 0.02
                0.10 0.12 0.78 0 0.02
                0    0    0    1 0"
            />
          </filter>
          <linearGradient id="cutout-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3a38" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#262624" stopOpacity="0.98" />
          </linearGradient>
          {boxes.map((b, i) => (
            <clipPath key={b.panel.id} id={`clip-${i}`}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} ry={3} />
            </clipPath>
          ))}
        </defs>

        {boxes.map((b, i) => {
          const placed = placeCutouts(b, b.panel.cutouts, scale);
          return (
            <g key={b.panel.id}>
              <g clipPath={`url(#clip-${i})`}>
                <image
                  href={sp.photo}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  preserveAspectRatio="xMidYMid slice"
                  filter={filterId}
                />
                {finish === "raw" && (
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#ffffff" opacity="0.05" />
                )}
              </g>

              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={3}
                ry={3}
                fill="none"
                stroke="#0c201c"
                strokeOpacity="0.5"
                strokeWidth="1.4"
              />

              {placed.map((pc, idx) => {
                const { cutout, rect, dLeft, dRight, dTop, dBottom } = pc;
                const cx = rect.x + rect.w / 2;
                const cy = rect.y + rect.h / 2;
                const hNearLeft = dLeft <= dRight;
                const vNearTop = dTop <= dBottom;
                const nearH = hNearLeft ? dLeft : dRight;
                const nearV = vNearTop ? dTop : dBottom;
                const hLabelX = hNearLeft
                  ? (b.x + rect.x) / 2
                  : (rect.x + rect.w + b.x + b.w) / 2;
                const vLabelY = vNearTop
                  ? (b.y + rect.y) / 2
                  : (rect.y + rect.h + b.y + b.h) / 2;
                // Leader-line endpoints: panel edge ↔ cutout edge at the
                // axis passing through the label. Gives the number
                // something to anchor to instead of floating.
                const hLineFrom = hNearLeft ? b.x : b.x + b.w;
                const hLineTo = hNearLeft ? rect.x : rect.x + rect.w;
                const vLineFrom = vNearTop ? b.y : b.y + b.h;
                const vLineTo = vNearTop ? rect.y : rect.y + rect.h;
                return (
                  <g key={cutout.id}>
                    <g
                      className="cutout"
                      tabIndex={onCutoutChange ? 0 : -1}
                      role={onCutoutChange ? "application" : undefined}
                      aria-label={onCutoutChange
                        ? `Cutout ${idx + 1} of ${placed.length}, ${cutout.widthMm} by ${cutout.depthMm} mm, ${Math.round(nearH)} mm from ${hNearLeft ? "left" : "right"}, ${Math.round(nearV)} mm from ${vNearTop ? "front" : "back"}. Arrow keys to move.`
                        : undefined}
                      onPointerDown={(e) => onCutoutPointerDown(e, b, cutout)}
                      onPointerMove={(e) => onCutoutPointerMove(e, b, cutout)}
                      onPointerUp={(e) => onCutoutPointerEnd(e, b, cutout)}
                      onPointerCancel={(e) => onCutoutPointerEnd(e, b, cutout)}
                      onKeyDown={(e) => onCutoutKeyDown(e, b, cutout)}
                    >
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} ry={3} fill="url(#cutout-grad)" />
                      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} ry={3} fill="none" stroke="#0c201c" strokeOpacity="0.55" strokeWidth="1" />
                      <rect className="cutout__ring" x={rect.x - 1.5} y={rect.y - 1.5} width={rect.w + 3} height={rect.h + 3} rx={4} ry={4} fill="none" />
                      <g className="cutout__grab" aria-hidden>
                        <circle cx={cx - 4} cy={cy} r="1.4" fill="#f3f0ee" fillOpacity="0.7" />
                        <circle cx={cx}     cy={cy} r="1.4" fill="#f3f0ee" fillOpacity="0.7" />
                        <circle cx={cx + 4} cy={cy} r="1.4" fill="#f3f0ee" fillOpacity="0.7" />
                      </g>
                    </g>

                    {/* distance leaders — panel edge to cutout edge, with the
                        number sitting on the line. Click the number to edit. */}
                    <g className="cutout__dim">
                      {/* horizontal leader (decorative, non-interactive) */}
                      <g className="cutout__leader" aria-hidden>
                        <line
                          x1={hLineFrom} y1={cy} x2={hLineTo} y2={cy}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                        <line
                          x1={hLineFrom} y1={cy - 3} x2={hLineFrom} y2={cy + 3}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                        <line
                          x1={hLineTo} y1={cy - 3} x2={hLineTo} y2={cy + 3}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                      </g>
                      {editing?.cutoutId === cutout.id && editing.field === "h" ? (
                        renderEdit(pc, "h", hLabelX - 24, cy - 11, 48, 22, Math.round(nearH), commitEdit, setEditing)
                      ) : (
                        <NumHit
                          cx={hLabelX} cy={cy} w={36} h={16}
                          value={Math.round(nearH)}
                          interactive={!!onCutoutChange}
                          aria={`Distance from ${hNearLeft ? "left" : "right"} edge, ${Math.round(nearH)} mm. Click to edit.`}
                          onOpen={() => setEditing({ cutoutId: cutout.id, field: "h" })}
                          textFill="#f3f0ee"
                          textOpacity={1}
                          variant="backlit"
                        />
                      )}
                      {/* vertical leader */}
                      <g className="cutout__leader" aria-hidden>
                        <line
                          x1={cx} y1={vLineFrom} x2={cx} y2={vLineTo}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                        <line
                          x1={cx - 3} y1={vLineFrom} x2={cx + 3} y2={vLineFrom}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                        <line
                          x1={cx - 3} y1={vLineTo} x2={cx + 3} y2={vLineTo}
                          stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1"
                        />
                      </g>
                      {editing?.cutoutId === cutout.id && editing.field === "v" ? (
                        renderEdit(pc, "v", cx - 24, vLabelY - 11, 48, 22, Math.round(nearV), commitEdit, setEditing)
                      ) : (
                        <NumHit
                          cx={cx} cy={vLabelY} w={36} h={16}
                          value={Math.round(nearV)}
                          interactive={!!onCutoutChange}
                          aria={`Distance from ${vNearTop ? "front" : "back"} edge, ${Math.round(nearV)} mm. Click to edit.`}
                          onOpen={() => setEditing({ cutoutId: cutout.id, field: "v" })}
                          textFill="#f3f0ee"
                          textOpacity={1}
                          variant="backlit"
                        />
                      )}
                    </g>

                    {/* Centre size label: W × D, each number independently
                        editable. Sits on top of the (charcoal) cutout fill.
                        Stops pointerdown propagation so the cutout's drag
                        handler doesn't steal the click. */}
                    <g
                      className="cutout__size"
                      onPointerDown={(e) => { if (onCutoutChange) e.stopPropagation(); }}
                    >
                      {editing?.cutoutId === cutout.id && editing.field === "w" ? (
                        renderEdit(pc, "w", cx - 44, cy - 11, 38, 22, cutout.widthMm, commitEdit, setEditing)
                      ) : (
                        <NumHit
                          cx={cx - 18} cy={cy} w={32} h={18}
                          value={cutout.widthMm}
                          interactive={!!onCutoutChange}
                          aria={`Cutout width, ${cutout.widthMm} mm. Click to edit.`}
                          onOpen={() => setEditing({ cutoutId: cutout.id, field: "w" })}
                          textFill="#f3f0ee"
                          textOpacity={0.95}
                          variant="dark"
                        />
                      )}
                      <text
                        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        fontSize="9" fill="#f3f0ee" fillOpacity="0.55"
                        fontFamily="Maven Pro, sans-serif" aria-hidden
                        style={{ pointerEvents: "none" }}
                      >
                        ×
                      </text>
                      {editing?.cutoutId === cutout.id && editing.field === "d" ? (
                        renderEdit(pc, "d", cx + 6, cy - 11, 38, 22, cutout.depthMm, commitEdit, setEditing)
                      ) : (
                        <NumHit
                          cx={cx + 18} cy={cy} w={32} h={18}
                          value={cutout.depthMm}
                          interactive={!!onCutoutChange}
                          aria={`Cutout depth, ${cutout.depthMm} mm. Click to edit.`}
                          onOpen={() => setEditing({ cutoutId: cutout.id, field: "d" })}
                          textFill="#f3f0ee"
                          textOpacity={0.95}
                          variant="dark"
                        />
                      )}
                    </g>
                  </g>
                );
              })}

              {b.panel.quantity > 1 && (
                <g>
                  <rect x={b.x + 8} y={b.y + b.h - 24} width={48} height={18} rx={9} fill="#0c201c" opacity="0.72" />
                  <text
                    x={b.x + 32}
                    y={b.y + b.h - 11}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#f3f0ee"
                    fontFamily="Maven Pro, sans-serif"
                  >
                    × {b.panel.quantity}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* per-panel length dimension (below each panel) */}
        {boxes.map((b) => {
          const dimY = b.y + b.h + 14;
          const midX = b.x + b.w / 2;
          return (
            <g key={`dim-h-${b.panel.id}`} className="panel-dim" aria-hidden>
              <line x1={b.x} y1={dimY} x2={b.x + b.w} y2={dimY}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <line x1={b.x} y1={dimY - 4} x2={b.x} y2={dimY + 4}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <line x1={b.x + b.w} y1={dimY - 4} x2={b.x + b.w} y2={dimY + 4}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <rect x={midX - 32} y={dimY - 10} width={64} height={20} rx={3}
                fill="#ffffff" fillOpacity="0.96" />
              <text x={midX} y={dimY} textAnchor="middle" dominantBaseline="middle"
                fontSize="14" fill="#0c201c" fillOpacity="0.9"
                fontFamily="Maven Pro, sans-serif" fontWeight="500"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {b.panel.length} mm
              </text>
            </g>
          );
        })}

        {/* depth dimension on the leftmost panel */}
        {boxes.length > 0 && (() => {
          const b = boxes[0];
          const dimX = b.x - 14;
          const midY = b.y + b.h / 2;
          return (
            <g className="panel-dim" aria-hidden>
              <line x1={dimX} y1={b.y} x2={dimX} y2={b.y + b.h}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <line x1={dimX - 4} y1={b.y} x2={dimX + 4} y2={b.y}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <line x1={dimX - 4} y1={b.y + b.h} x2={dimX + 4} y2={b.y + b.h}
                stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              <g transform={`translate(${dimX} ${midY}) rotate(-90)`}>
                <rect x={-32} y={-10} width={64} height={20} rx={3}
                  fill="#ffffff" fillOpacity="0.96" />
                <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
                  fontSize="14" fill="#0c201c" fillOpacity="0.9"
                  fontFamily="Maven Pro, sans-serif" fontWeight="500"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {b.panel.width} mm
                </text>
              </g>
            </g>
          );
        })()}
      </svg>

      <div aria-hidden className="slab-preview__fallback" data-species={species}>
        <Offcut species={species} />
      </div>
    </div>
  );
}

function layout(panels: Panel[]) {
  const totalLen =
    panels.reduce((a, p) => a + p.length, 0) + GAP_MM * Math.max(0, panels.length - 1);
  const maxWid = Math.max(...panels.map((p) => p.width), 200);
  const availW = VIEW.w - MARGIN_LEFT - MARGIN_RIGHT;
  const availH = VIEW.h - MARGIN_TOP - MARGIN_BOTTOM - DIM_RESERVE;
  const scale = Math.min(availW / totalLen, availH / maxWid);

  const laidOutWidth = totalLen * scale;
  const startX = MARGIN_LEFT + (availW - laidOutWidth) / 2;
  const centreY = MARGIN_TOP + (availH - maxWid * scale) / 2;

  const boxes = panels.reduce<{ items: Box[]; cx: number }>(
    (acc, p) => {
      const w = p.length * scale;
      const h = p.width * scale;
      const y = centreY + (maxWid * scale - h) / 2;
      return {
        items: [...acc.items, { x: acc.cx, y, w, h, panel: p }],
        cx: acc.cx + w + GAP_MM * scale,
      };
    },
    { items: [], cx: startX },
  ).items;

  return { boxes, scale };
}

/**
 * Clickable number label. Three visual variants:
 *   - default:  cream plate for labels on the timber surface
 *   - dark:     faint translucent chip for labels on charcoal cutouts
 *   - backlit:  no plate, just text with a dark halo stroke. Reads like
 *               a glowing number floating on the slab.
 */
type NumHitVariant = "plate" | "dark" | "backlit";

function NumHit({
  cx, cy, w, h, value, interactive, aria, onOpen,
  textFill, textOpacity, variant = "plate",
}: {
  cx: number; cy: number; w: number; h: number;
  value: number;
  interactive: boolean;
  aria: string;
  onOpen: () => void;
  textFill: string;
  textOpacity: number;
  variant?: NumHitVariant;
}) {
  const handleOpen = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    onOpen();
  };
  const variantClass =
    variant === "dark" ? " cutout__num--dark"
    : variant === "backlit" ? " cutout__num--backlit"
    : "";
  return (
    <g
      className={`cutout__num${variantClass}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={aria}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen(e);
        }
      }}
    >
      {variant === "backlit" ? (
        // Invisible hit target so the text's tiny bounding box isn't the
        // only thing capturing clicks.
        <rect
          x={cx - w / 2} y={cy - h / 2} width={w} height={h}
          fill="transparent" pointerEvents="all"
        />
      ) : (
        <rect
          className="cutout__num-plate"
          x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={4}
        />
      )}
      <text
        className="cutout__num-text"
        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fontSize="9.5"
        fill={variant === "backlit" ? "#f3f0ee" : textFill}
        fillOpacity={variant === "backlit" ? 1 : textOpacity}
        stroke={variant === "backlit" ? "#0c201c" : undefined}
        strokeWidth={variant === "backlit" ? 2.6 : undefined}
        strokeLinejoin={variant === "backlit" ? "round" : undefined}
        strokeOpacity={variant === "backlit" ? 0.9 : undefined}
        paintOrder={variant === "backlit" ? "stroke fill" : undefined}
        fontFamily="Maven Pro, sans-serif" fontWeight={500}
        style={{ fontVariantNumeric: "tabular-nums", pointerEvents: "none", letterSpacing: "0.01em" }}
      >
        {value}
      </text>
    </g>
  );
}

/**
 * Inline-edit input rendered inside an SVG <foreignObject>. Uses text +
 * inputMode=numeric so no browser spinner chrome renders. Styled via the
 * .cutout__edit class in styles.css.
 */
function renderEdit(
  placed: PlacedCutout,
  field: EditField,
  x: number,
  y: number,
  width: number,
  height: number,
  initial: number,
  commit: (p: PlacedCutout, f: EditField, raw: string) => void,
  cancel: (v: null) => void,
) {
  return (
    <foreignObject x={x} y={y} width={width} height={height} style={{ overflow: "visible" }}>
      <input
        className="cutout__edit"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        defaultValue={initial}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          // Strip anything non-digit as the user types.
          const digitsOnly = e.currentTarget.value.replace(/\D/g, "");
          if (digitsOnly !== e.currentTarget.value) {
            e.currentTarget.value = digitsOnly;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(placed, field, e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel(null);
          }
        }}
        onBlur={(e) => commit(placed, field, e.currentTarget.value)}
      />
    </foreignObject>
  );
}

function placeCutouts(box: Box, cutouts: Cutout[], scale: number): PlacedCutout[] {
  if (!cutouts || cutouts.length === 0) return [];
  const panel = box.panel;
  return cutouts.map((cutout) => {
    const along = cutout.widthMm * scale;
    const across = cutout.depthMm * scale;
    const pos = clamp(cutout.pos, 0, 1);
    const cross = clamp(cutout.cross, 0, 1);
    const centreXMm = pos * panel.length;
    const centreYMm = cross * panel.width;
    const dLeft = Math.max(0, centreXMm - cutout.widthMm / 2);
    const dRight = Math.max(0, panel.length - centreXMm - cutout.widthMm / 2);
    const dTop = Math.max(0, centreYMm - cutout.depthMm / 2);
    const dBottom = Math.max(0, panel.width - centreYMm - cutout.depthMm / 2);
    return {
      cutout,
      box,
      rect: {
        x: box.x + pos * box.w - along / 2,
        y: box.y + cross * box.h - across / 2,
        w: along,
        h: across,
      },
      dLeft, dRight, dTop, dBottom,
    };
  });
}
