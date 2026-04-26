import { useState } from "react";
import type { Adjustment } from "../state";

interface Props {
  adjustments: Adjustment[];
  onDismiss: () => void;
}

export function LoadAdjustmentNotice({ adjustments, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const count = adjustments.length;
  if (count === 0) return null;
  return (
    <div className="load-notice" role="status">
      <div className="load-notice__summary">
        <span className="load-notice__text">
          We adjusted {count} {count === 1 ? "value" : "values"} in this quote because they were outside the allowed range.
        </span>
        <button
          type="button"
          className="load-notice__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Hide details" : "View details"} {expanded ? "▴" : "▾"}
        </button>
        <button
          type="button"
          className="load-notice__close"
          aria-label="Dismiss notice"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul className="load-notice__details">
          {adjustments.map((a, i) => (
            <li key={i}>{describe(a)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const panelName = (label: string, panelIndex: number) =>
  label.trim() ? label : `Panel ${panelIndex + 1}`;

function describe(a: Adjustment): string {
  switch (a.kind) {
    case "panel.length":
      return `${panelName(a.panelLabel, a.panelIndex)} length: ${a.from} mm → ${a.to} mm (${a.reason}).`;
    case "panel.width":
      return `${panelName(a.panelLabel, a.panelIndex)} width: ${a.from} mm → ${a.to} mm (${a.reason}).`;
    case "panel.thickness":
      return `${panelName(a.panelLabel, a.panelIndex)} thickness: ${a.from} mm → ${a.to} mm (${a.reason}).`;
    case "panel.quantity":
      return `${panelName(a.panelLabel, a.panelIndex)} quantity: ${a.from} → ${a.to} (${a.reason}).`;
    case "cutout.width":
      return `${panelName(a.panelLabel, a.panelIndex)} cutout ${a.cutoutIndex + 1} width: ${a.from} mm → ${a.to} mm (${a.reason}).`;
    case "cutout.depth":
      return `${panelName(a.panelLabel, a.panelIndex)} cutout ${a.cutoutIndex + 1} depth: ${a.from} mm → ${a.to} mm (${a.reason}).`;
    case "cutout.position":
      return `${panelName(a.panelLabel, a.panelIndex)} cutout ${a.cutoutIndex + 1}: ${a.reason}.`;
  }
}
