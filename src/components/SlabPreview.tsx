import { useMemo, useRef, useState } from "react";
import type { Cutout, Panel } from "../pricing";
import {
  findSpecies,
  MIN_LENGTH_MM,
  MIN_WIDTH_MM,
  type ColourId,
  type FinishId,
  type SpeciesId,
} from "../species";
import { Offcut } from "./Offcut";

interface Props {
  panels: Panel[];
  species: SpeciesId;
  finish: FinishId;
  colour: ColourId;
  onCutoutChange?: (panelId: string, cutoutId: string, updates: Partial<Cutout>) => void;
  /** Narrow patch for on-canvas dim editing (click a label, or drag an edge/corner). */
  onPanelChange?: (panelId: string, updates: Partial<Pick<Panel, "length" | "width">>) => void;
}

const VIEW = { w: 1000, h: 356 };
const MARGIN_TOP = 18;
const MARGIN_RIGHT = 20;
const MARGIN_BOTTOM = 14;
const MARGIN_LEFT = 42;
const DIM_RESERVE = 22;
const GAP_MM = 80;

// Resize handles: invisible rects layered on the panel edges/corners.
// Thicker on touch, but 10 SVG units is fine on desktop.
const EDGE_HIT = 10;
const CORNER_HIT = 18;

// Panel dimensions click to the nearest centimetre — same step that
// PanelEditor's NumField uses.
const PANEL_SNAP_MM = 10;

// Matches PanelEditor's NumField max values. Floors (MIN_LENGTH_MM /
// MIN_WIDTH_MM) come from species.ts.
const PANEL_MAX_LENGTH_MM = 4800;
const PANEL_MAX_WIDTH_MM = 2000;

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

type ResizeHandle = "e" | "w" | "n" | "s" | "ne" | "nw" | "se" | "sw";

interface PanelResizeState {
  panelId: string;
  pointerId: number;
  handle: ResizeHandle;
  startLenMm: number;
  startWidthMm: number;
  /** Drag start in SVG local coordinates (not client pixels) — the SVG's
   *  display size may differ from its viewBox size, so we convert via the
   *  current screen CTM. */
  startSvgX: number;
  startSvgY: number;
  /** Panel's SVG-coord position + size at drag start. Used to anchor the
   *  opposite edge during the drag so absolute-positioning math is stable. */
  startBoxX: number;
  startBoxY: number;
  startBoxW: number;
  startBoxH: number;
  /** SVG-coord units per mm at drag start. Held constant for the whole drag
   *  so layout() re-centering / re-scaling doesn't break cursor tracking. */
  scale: number;
  /** Last emitted dims so we only call onPanelChange when the snapped value changes. */
  lastLenMm: number;
  lastWidthMm: number;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const snap = (mm: number, step: number = PANEL_SNAP_MM) =>
  Math.round(mm / step) * step;

type CutoutField = "h" | "v" | "w" | "d";
type PanelField = "length" | "width";

type EditingState =
  | { kind: "cutout"; cutoutId: string; field: CutoutField }
  | { kind: "panel"; panelId: string; field: PanelField };

export function SlabPreview({
  panels, species, finish, colour, onCutoutChange, onPanelChange,
}: Props) {
  const sp = findSpecies(species);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panelResizeRef = useRef<PanelResizeState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Bumped on drag start/end so the layout-freeze logic below re-runs at
  // those boundaries even when `panels` hasn't changed yet.
  const [, setDragTick] = useState(0);

  const baseLayout = useMemo(() => layout(panels), [panels]);
  // During an active panel resize, pin the panel's on-screen position to
  // where it was at drag start, and use the cached scale so visual growth
  // tracks 1:1 with mm growth. Non-active panels stay where they are.
  // This is the piece that makes absolute-positioning in the move handler
  // actually look right on screen.
  const active = panelResizeRef.current;
  const boxes: Box[] = active
    ? baseLayout.boxes.map((b) => {
        if (b.panel.id !== active.panelId) return b;
        return {
          x: active.startBoxX,
          y: active.startBoxY,
          w: b.panel.length * active.scale,
          h: b.panel.width * active.scale,
          panel: b.panel,
        };
      })
    : baseLayout.boxes;
  const scale = active ? active.scale : baseLayout.scale;

  // Compose colour × finish into a single filter id. `clear` + `oiled` is
  // the natural look (no transform). Other combinations reference filters
  // defined in the SVG <defs> below; for a colour + raw combination the
  // filter chains the colour matrix into the raw matrix internally.
  const filterId =
    colour === "clear" && finish === "oiled"
      ? undefined
      : colour === "clear" && finish === "raw"
        ? "url(#finish-raw)"
        : `url(#colour-${colour}${finish === "raw" ? "-raw" : ""})`;

  const commitEdit = (placed: PlacedCutout, field: CutoutField, raw: string) => {
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
        const maxW = Math.max(50, panel.length);
        const next = clamp(n, 50, maxW);
        const nextPos = clamp((currFromLeft + next / 2) / panel.length, 0, 1);
        onCutoutChange(panel.id, cutout.id, { widthMm: next, pos: nextPos });
        break;
      }
      case "d": {
        const currFromTop = cutout.cross * panel.width - cutout.depthMm / 2;
        const maxD = Math.max(50, panel.width);
        const next = clamp(n, 50, maxD);
        const nextCross = clamp((currFromTop + next / 2) / panel.width, 0, 1);
        onCutoutChange(panel.id, cutout.id, { depthMm: next, cross: nextCross });
        break;
      }
    }
    setEditing(null);
  };

  const commitPanelEdit = (panelId: string, field: PanelField, raw: string) => {
    if (!onPanelChange) { setEditing(null); return; }
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed)) { setEditing(null); return; }
    const snapped = snap(parsed);
    const clamped = field === "length"
      ? clamp(snapped, MIN_LENGTH_MM, PANEL_MAX_LENGTH_MM)
      : clamp(snapped, MIN_WIDTH_MM, PANEL_MAX_WIDTH_MM);
    onPanelChange(panelId, { [field]: clamped });
    setEditing(null);
  };

  // Convert a pointer event's client coords to SVG-viewBox local coords.
  // This is the only way to get a stable mm delta when the SVG is displayed
  // at a size different from its viewBox (which is the common case — the
  // preview stretches to container width).
  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  };

  const onPanelResizeDown = (
    e: React.PointerEvent<SVGRectElement>,
    box: Box,
    handle: ResizeHandle,
  ) => {
    if (!onPanelChange) return;
    // A cutout drag must not be in flight — if it is, let it finish first.
    if (dragRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const local = clientToSvg(e.clientX, e.clientY);
    if (!local) return;
    panelResizeRef.current = {
      panelId: box.panel.id,
      pointerId: e.pointerId,
      handle,
      startLenMm: box.panel.length,
      startWidthMm: box.panel.width,
      startSvgX: local.x,
      startSvgY: local.y,
      startBoxX: box.x,
      startBoxY: box.y,
      startBoxW: box.w,
      startBoxH: box.h,
      scale,
      lastLenMm: box.panel.length,
      lastWidthMm: box.panel.width,
    };
    // Tick so the render layer picks up the frozen layout immediately.
    setDragTick((n) => n + 1);
  };

  const onPanelResizeMove = (e: React.PointerEvent<SVGRectElement>) => {
    const s = panelResizeRef.current;
    if (!s || !onPanelChange) return;
    if (e.pointerId !== s.pointerId) return;

    const local = clientToSvg(e.clientX, e.clientY);
    if (!local) return;

    // Absolute positioning from the opposite edge, not cursor deltas. This
    // is what makes the drag track even as the panel mm dims change: the
    // anchor edge is pinned in SVG coords at its drag-start position, and
    // the dragged edge follows the cursor. Layout rescaling is frozen in
    // render too (see the active-resize override below), so the anchor
    // really does stay put on screen.
    let targetLen = s.startLenMm;
    let targetWid = s.startWidthMm;

    if (s.handle.includes("e")) {
      // E drag: W edge pinned at startBoxX, E edge follows cursor.
      targetLen = (local.x - s.startBoxX) / s.scale;
    } else if (s.handle.includes("w")) {
      // W drag: E edge pinned at startBoxX + startBoxW, W edge follows cursor.
      targetLen = (s.startBoxX + s.startBoxW - local.x) / s.scale;
    }

    if (s.handle.includes("s")) {
      targetWid = (local.y - s.startBoxY) / s.scale;
    } else if (s.handle.includes("n")) {
      targetWid = (s.startBoxY + s.startBoxH - local.y) / s.scale;
    }

    const nextLen = clamp(snap(targetLen), MIN_LENGTH_MM, PANEL_MAX_LENGTH_MM);
    const nextWid = clamp(snap(targetWid), MIN_WIDTH_MM, PANEL_MAX_WIDTH_MM);

    const touchesH = s.handle.includes("e") || s.handle.includes("w");
    const touchesV = s.handle.includes("n") || s.handle.includes("s");

    const updates: Partial<Pick<Panel, "length" | "width">> = {};
    if (touchesH && nextLen !== s.lastLenMm) {
      updates.length = nextLen;
      s.lastLenMm = nextLen;
    }
    if (touchesV && nextWid !== s.lastWidthMm) {
      updates.width = nextWid;
      s.lastWidthMm = nextWid;
    }
    if (updates.length !== undefined || updates.width !== undefined) {
      onPanelChange(s.panelId, updates);
    }
  };

  const onPanelResizeEnd = (e: React.PointerEvent<SVGRectElement>) => {
    const s = panelResizeRef.current;
    if (!s) return;
    if (e.pointerId !== s.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    panelResizeRef.current = null;
    // Force a re-render so the render branch below un-freezes the layout.
    setDragTick((n) => n + 1);
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
    // Panel-edge/corner resize wins if one is in flight.
    if (panelResizeRef.current) return;
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

          {/*
            Colour stain matrices. Each row is `r g b a offset` for the
            corresponding output channel. These are intentionally subtle
            tints — they should look like a stain layered on the timber
            photo, not like a flat overlay. Tune by eye against the three
            species photos; if a tint reads too strongly on one species,
            soften the diagonal coefficients first.

            "Country bark" — warm medium brown stain. Shifts the photo
            toward red-brown by lifting the red channel slightly,
            holding the green, and damping the blue.
            "Darkwash"     — deep espresso. Heavily darkens overall and
            keeps a brown bias by holding red higher than green/blue.
          */}
          <filter id="colour-bark" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values="
                1.06  0.06 -0.02 0  0.02
                0.04  0.94  0.02 0 -0.02
               -0.04 -0.02  0.78 0 -0.04
                0     0     0    1  0"
            />
          </filter>
          <filter id="colour-bark-raw" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values="
                1.06  0.06 -0.02 0  0.02
                0.04  0.94  0.02 0 -0.02
               -0.04 -0.02  0.78 0 -0.04
                0     0     0    1  0"
              result="bark"
            />
            <feColorMatrix
              in="bark"
              type="matrix"
              values="
                0.78 0.15 0.07 0 0.02
                0.15 0.78 0.07 0 0.02
                0.10 0.12 0.78 0 0.02
                0    0    0    1 0"
            />
          </filter>
          <filter id="colour-darkwash" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values="
                0.62 0.10 0.04 0 -0.06
                0.20 0.50 0.04 0 -0.10
                0.08 0.08 0.40 0 -0.10
                0    0    0    1  0"
            />
          </filter>
          <filter id="colour-darkwash-raw" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              type="matrix"
              values="
                0.62 0.10 0.04 0 -0.06
                0.20 0.50 0.04 0 -0.10
                0.08 0.08 0.40 0 -0.10
                0    0    0    1  0"
              result="darkwash"
            />
            <feColorMatrix
              in="darkwash"
              type="matrix"
              values="
                0.78 0.15 0.07 0 0.02
                0.15 0.78 0.07 0 0.02
                0.10 0.12 0.78 0 0.02
                0    0    0    1 0"
            />
          </filter>
          <linearGradient id="cutout-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#faf7f2" stopOpacity="1" />
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

              {/* Panel resize handles — rendered below cutouts so cutouts
                  still catch their own pointer events. Edges sit on the
                  panel border (half outside, half inside); corners are
                  layered on top of edges so they win at the intersection.
                  Mid-edge "grip" dots and corner dots give subtle
                  always-visible affordance. */}
              {onPanelChange && (() => {
                const midX = b.x + b.w / 2;
                const midY = b.y + b.h / 2;
                return (
                  <g className="panel-resize">
                    {/* ── Edges (hit-areas) ─────────────────────────── */}
                    <rect
                      className="panel-resize__edge panel-resize__edge--n"
                      x={b.x} y={b.y - EDGE_HIT / 2}
                      width={b.w} height={EDGE_HIT}
                      onPointerDown={(e) => onPanelResizeDown(e, b, "n")}
                      onPointerMove={onPanelResizeMove}
                      onPointerUp={onPanelResizeEnd}
                      onPointerCancel={onPanelResizeEnd}
                    />
                    <rect
                      className="panel-resize__edge panel-resize__edge--s"
                      x={b.x} y={b.y + b.h - EDGE_HIT / 2}
                      width={b.w} height={EDGE_HIT}
                      onPointerDown={(e) => onPanelResizeDown(e, b, "s")}
                      onPointerMove={onPanelResizeMove}
                      onPointerUp={onPanelResizeEnd}
                      onPointerCancel={onPanelResizeEnd}
                    />
                    <rect
                      className="panel-resize__edge panel-resize__edge--w"
                      x={b.x - EDGE_HIT / 2} y={b.y}
                      width={EDGE_HIT} height={b.h}
                      onPointerDown={(e) => onPanelResizeDown(e, b, "w")}
                      onPointerMove={onPanelResizeMove}
                      onPointerUp={onPanelResizeEnd}
                      onPointerCancel={onPanelResizeEnd}
                    />
                    <rect
                      className="panel-resize__edge panel-resize__edge--e"
                      x={b.x + b.w - EDGE_HIT / 2} y={b.y}
                      width={EDGE_HIT} height={b.h}
                      onPointerDown={(e) => onPanelResizeDown(e, b, "e")}
                      onPointerMove={onPanelResizeMove}
                      onPointerUp={onPanelResizeEnd}
                      onPointerCancel={onPanelResizeEnd}
                    />

                    {/* ── Mid-edge grip dots (3 each, matching cutout vibe) ── */}
                    <g className="panel-resize__grip" aria-hidden pointerEvents="none">
                      {/* N: 3 dots arranged horizontally at top-center */}
                      <circle cx={midX - 5} cy={b.y} r={1.1} />
                      <circle cx={midX}     cy={b.y} r={1.1} />
                      <circle cx={midX + 5} cy={b.y} r={1.1} />
                      {/* S: 3 dots at bottom-center */}
                      <circle cx={midX - 5} cy={b.y + b.h} r={1.1} />
                      <circle cx={midX}     cy={b.y + b.h} r={1.1} />
                      <circle cx={midX + 5} cy={b.y + b.h} r={1.1} />
                      {/* W: 3 dots arranged vertically at left-middle */}
                      <circle cx={b.x} cy={midY - 5} r={1.1} />
                      <circle cx={b.x} cy={midY}     r={1.1} />
                      <circle cx={b.x} cy={midY + 5} r={1.1} />
                      {/* E: 3 dots at right-middle */}
                      <circle cx={b.x + b.w} cy={midY - 5} r={1.1} />
                      <circle cx={b.x + b.w} cy={midY}     r={1.1} />
                      <circle cx={b.x + b.w} cy={midY + 5} r={1.1} />
                    </g>

                    {/* ── Corners (hit-area + always-visible dot) ───────── */}
                    {(["nw", "ne", "sw", "se"] as const).map((h) => {
                      const cx = h.includes("w") ? b.x : b.x + b.w;
                      const cy = h.includes("n") ? b.y : b.y + b.h;
                      return (
                        <g key={h} className={`panel-resize__corner panel-resize__corner--${h}`}>
                          <rect
                            x={cx - CORNER_HIT / 2}
                            y={cy - CORNER_HIT / 2}
                            width={CORNER_HIT}
                            height={CORNER_HIT}
                            fill="transparent"
                            onPointerDown={(e) => onPanelResizeDown(e, b, h)}
                            onPointerMove={onPanelResizeMove}
                            onPointerUp={onPanelResizeEnd}
                            onPointerCancel={onPanelResizeEnd}
                          />
                          <circle
                            className="panel-resize__dot"
                            cx={cx} cy={cy} r={2.6}
                            aria-hidden
                            pointerEvents="none"
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

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
                        <circle cx={cx - 4} cy={cy} r="1.4" fill="#0c201c" fillOpacity="0.55" />
                        <circle cx={cx}     cy={cy} r="1.4" fill="#0c201c" fillOpacity="0.55" />
                        <circle cx={cx + 4} cy={cy} r="1.4" fill="#0c201c" fillOpacity="0.55" />
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
                      {editing?.kind === "cutout" && editing.cutoutId === cutout.id && editing.field === "h" ? (
                        renderEdit(
                          hLabelX - 34, cy - 16, 68, 32, Math.round(nearH),
                          (raw) => commitEdit(pc, "h", raw),
                          () => setEditing(null),
                        )
                      ) : (
                        <NumHit
                          cx={hLabelX} cy={cy} w={48} h={22}
                          value={Math.round(nearH)}
                          interactive={!!onCutoutChange}
                          aria={`Distance from ${hNearLeft ? "left" : "right"} edge, ${Math.round(nearH)} mm. Click to edit.`}
                          onOpen={() => setEditing({ kind: "cutout", cutoutId: cutout.id, field: "h" })}
                          textFill="#0c201c"
                          textOpacity={0.92}
                          variant="plate"
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
                      {editing?.kind === "cutout" && editing.cutoutId === cutout.id && editing.field === "v" ? (
                        renderEdit(
                          cx - 34, vLabelY - 16, 68, 32, Math.round(nearV),
                          (raw) => commitEdit(pc, "v", raw),
                          () => setEditing(null),
                        )
                      ) : (
                        <NumHit
                          cx={cx} cy={vLabelY} w={48} h={22}
                          value={Math.round(nearV)}
                          interactive={!!onCutoutChange}
                          aria={`Distance from ${vNearTop ? "front" : "back"} edge, ${Math.round(nearV)} mm. Click to edit.`}
                          onOpen={() => setEditing({ kind: "cutout", cutoutId: cutout.id, field: "v" })}
                          textFill="#0c201c"
                          textOpacity={0.92}
                          variant="plate"
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
                      {editing?.kind === "cutout" && editing.cutoutId === cutout.id && editing.field === "w" ? (
                        renderEdit(
                          cx - 62, cy - 16, 54, 32, cutout.widthMm,
                          (raw) => commitEdit(pc, "w", raw),
                          () => setEditing(null),
                        )
                      ) : (
                        <NumHit
                          cx={cx - 26} cy={cy} w={44} h={22}
                          value={cutout.widthMm}
                          interactive={!!onCutoutChange}
                          aria={`Cutout width, ${cutout.widthMm} mm. Click to edit.`}
                          onOpen={() => setEditing({ kind: "cutout", cutoutId: cutout.id, field: "w" })}
                          textFill="#0c201c"
                          textOpacity={0.92}
                          variant="plate"
                        />
                      )}
                      <text
                        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        dy="0.04em"
                        fontSize="12" fill="#0c201c" fillOpacity="0.45"
                        fontFamily="Maven Pro, sans-serif" aria-hidden fontWeight={500}
                        style={{ pointerEvents: "none" }}
                      >
                        ×
                      </text>
                      {editing?.kind === "cutout" && editing.cutoutId === cutout.id && editing.field === "d" ? (
                        renderEdit(
                          cx + 8, cy - 16, 54, 32, cutout.depthMm,
                          (raw) => commitEdit(pc, "d", raw),
                          () => setEditing(null),
                        )
                      ) : (
                        <NumHit
                          cx={cx + 26} cy={cy} w={44} h={22}
                          value={cutout.depthMm}
                          interactive={!!onCutoutChange}
                          aria={`Cutout depth, ${cutout.depthMm} mm. Click to edit.`}
                          onOpen={() => setEditing({ kind: "cutout", cutoutId: cutout.id, field: "d" })}
                          textFill="#0c201c"
                          textOpacity={0.92}
                          variant="plate"
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

        {/* per-panel length dimension (below each panel) — clickable to edit. */}
        {boxes.map((b) => {
          const dimY = b.y + b.h + 14;
          const midX = b.x + b.w / 2;
          const isEditing = editing?.kind === "panel"
            && editing.panelId === b.panel.id
            && editing.field === "length";
          return (
            <g key={`dim-h-${b.panel.id}`} className="panel-dim">
              <g aria-hidden>
                <line x1={b.x} y1={dimY} x2={b.x + b.w} y2={dimY}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
                <line x1={b.x} y1={dimY - 4} x2={b.x} y2={dimY + 4}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
                <line x1={b.x + b.w} y1={dimY - 4} x2={b.x + b.w} y2={dimY + 4}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              </g>
              {isEditing ? (
                renderEdit(
                  midX - 38, dimY - 16, 76, 32, b.panel.length,
                  (raw) => commitPanelEdit(b.panel.id, "length", raw),
                  () => setEditing(null),
                )
              ) : (
                <PanelDimHit
                  cx={midX} cy={dimY} w={50} h={22}
                  value={b.panel.length}
                  interactive={!!onPanelChange}
                  aria={`Panel length, ${b.panel.length} mm. Click to edit.`}
                  onOpen={() => setEditing({ kind: "panel", panelId: b.panel.id, field: "length" })}
                />
              )}
            </g>
          );
        })}

        {/* width dimension on the leftmost panel — clickable to edit. */}
        {boxes.length > 0 && (() => {
          const b = boxes[0];
          const dimX = b.x - 14;
          const midY = b.y + b.h / 2;
          const isEditing = editing?.kind === "panel"
            && editing.panelId === b.panel.id
            && editing.field === "width";
          return (
            <g className="panel-dim">
              <g aria-hidden>
                <line x1={dimX} y1={b.y} x2={dimX} y2={b.y + b.h}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
                <line x1={dimX - 4} y1={b.y} x2={dimX + 4} y2={b.y}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
                <line x1={dimX - 4} y1={b.y + b.h} x2={dimX + 4} y2={b.y + b.h}
                  stroke="#0c201c" strokeOpacity="0.38" strokeWidth="1" />
              </g>
              {isEditing ? (
                // Input sits above the (rotated) label in screen space —
                // place it at the dim anchor with a fixed horizontal footprint.
                renderEdit(
                  dimX - 38, midY - 16, 76, 32, b.panel.width,
                  (raw) => commitPanelEdit(b.panel.id, "width", raw),
                  () => setEditing(null),
                )
              ) : (
                <g transform={`translate(${dimX} ${midY}) rotate(-90)`}>
                  <PanelDimHit
                    cx={0} cy={0} w={50} h={22}
                    value={b.panel.width}
                    interactive={!!onPanelChange}
                    aria={`Panel width, ${b.panel.width} mm. Click to edit.`}
                    onOpen={() => setEditing({ kind: "panel", panelId: b.panel.id, field: "width" })}
                  />
                </g>
              )}
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
  // Visually centre the panel in the viewBox. `availH` already excludes
  // the DIM_RESERVE strip kept at the bottom for dimension labels; if we
  // simply centre within availH the panel sits anchored to the top of
  // that strip, which reads as off-centre toward the top (more visible
  // for tall panels like 3900 × 1200). Bias by half of DIM_RESERVE so
  // the panel's visual midline lands on the viewBox midline. Labels
  // still get clearance below because the scale is constrained by
  // (availH excl. DIM_RESERVE), not by the centering offset.
  const centreY = MARGIN_TOP + (availH - maxWid * scale) / 2 + DIM_RESERVE / 2;

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
        dy="0.04em"
        fontSize="13"
        fill={textFill}
        fillOpacity={textOpacity}
        fontFamily="Maven Pro, sans-serif" fontWeight={600}
        style={{ fontVariantNumeric: "tabular-nums", pointerEvents: "none", letterSpacing: "0.01em" }}
      >
        {value}
      </text>
    </g>
  );
}

/**
 * Clickable panel-dimension label. Matches the existing white-plate dim
 * look exactly, but opens an inline editor on click.
 */
function PanelDimHit({
  cx, cy, w, h, value, interactive, aria, onOpen,
}: {
  cx: number; cy: number; w: number; h: number;
  value: number;
  interactive: boolean;
  aria: string;
  onOpen: () => void;
}) {
  const handleOpen = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    onOpen();
  };
  return (
    <g
      className="panel-dim__hit"
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
      <rect
        x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3}
        fill="#ffffff" fillOpacity="0.96"
      />
      <text
        x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fontSize="14" fill="#0c201c" fillOpacity="0.9"
        fontFamily="Maven Pro, sans-serif" fontWeight="500"
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
 *
 * Generic over the commit callback so both cutout and panel edits share
 * the same visual + keyboard behaviour.
 */
function renderEdit(
  x: number,
  y: number,
  width: number,
  height: number,
  initial: number,
  onCommit: (raw: string) => void,
  onCancel: () => void,
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
          const digitsOnly = e.currentTarget.value.replace(/\D/g, "");
          if (digitsOnly !== e.currentTarget.value) {
            e.currentTarget.value = digitsOnly;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
      />
    </foreignObject>
  );
}

function placeCutouts(box: Box, cutouts: Cutout[], scale: number): PlacedCutout[] {
  if (!cutouts || cutouts.length === 0) return [];
  const panel = box.panel;
  return cutouts.map((cutout) => {
    // Defensive clamp: malformed data (cutout larger than panel) must never
    // push the rect outside the slab fill, otherwise the cutout overlay
    // hides the panel entirely and the SVG looks broken.
    const widthMm = Math.min(cutout.widthMm, panel.length);
    const depthMm = Math.min(cutout.depthMm, panel.width);
    const along = widthMm * scale;
    const across = depthMm * scale;
    const halfAlong = widthMm / 2 / panel.length;
    const halfAcross = depthMm / 2 / panel.width;
    const pos = clamp(cutout.pos, halfAlong, 1 - halfAlong);
    const cross = clamp(cutout.cross, halfAcross, 1 - halfAcross);
    const centreXMm = pos * panel.length;
    const centreYMm = cross * panel.width;
    const dLeft = Math.max(0, centreXMm - widthMm / 2);
    const dRight = Math.max(0, panel.length - centreXMm - widthMm / 2);
    const dTop = Math.max(0, centreYMm - depthMm / 2);
    const dBottom = Math.max(0, panel.width - centreYMm - depthMm / 2);
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
