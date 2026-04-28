import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Cutout, Panel, Quote } from "./pricing";
import { panelPriceMap, priceQuote } from "./pricing";
import type { ShippingMode } from "./shipping";
import {
  blankPanel,
  constrainCutout,
  defaultQuote,
  loadInitial,
  normalizePanel,
  persist,
  quoteHasMainPanel,
  type Adjustment,
} from "./state";
import { findSpecies, type FinishId, type SpeciesId } from "./species";
import { SlabPreview } from "./components/SlabPreview";
import { PanelEditor } from "./components/PanelEditor";
import { TimberPicker } from "./components/TimberPicker";
import { StickyBar } from "./components/StickyBar";
import { QuoteForm } from "./components/QuoteForm";
import { LoadAdjustmentNotice } from "./components/LoadAdjustmentNotice";

export default function App() {
  const initial = useMemo(() => loadInitial(), []);
  const [quote, setQuote] = useState<Quote>(initial.quote);
  const [loadAdjustments, setLoadAdjustments] = useState<Adjustment[]>(initial.adjustments);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Snapshots of the rehydrated state — when any of these refs differ from
  // the current quote, the customer has made a real config edit and any
  // load-time adjustment notice should auto-dismiss.
  const initialPanelsRef = useRef(initial.quote.panels);
  const initialSpeciesRef = useRef(initial.quote.species);
  const initialFinishRef = useRef(initial.quote.finish);
  const initialShippingRef = useRef(initial.quote.shipping);

  useEffect(() => { persist(quote); }, [quote]);

  useEffect(() => {
    if (
      quote.panels !== initialPanelsRef.current ||
      quote.species !== initialSpeciesRef.current ||
      quote.finish !== initialFinishRef.current ||
      quote.shipping !== initialShippingRef.current
    ) {
      setLoadAdjustments((prev) => (prev.length === 0 ? prev : []));
    }
  }, [quote.panels, quote.species, quote.finish, quote.shipping]);

  const totals = useMemo(() => priceQuote(quote), [quote]);
  const hasMainPanel = useMemo(
    () => quoteHasMainPanel(quote),
    [quote],
  );

  const updatePanel = useCallback((id: string, next: Panel) =>
    setQuote((q) => ({
      ...q,
      panels: q.panels.map((p) => (p.id === id ? normalizePanel(next) : p)),
    })), []);

  // Narrow patch for the on-canvas panel edits (click a dim to edit, drag
  // an edge/corner to resize). Only length + width live on the preview —
  // thickness and quantity stay in the editor below. Cutouts auto-shrink
  // when the panel shrinks below them, via normalizePanel.
  const patchPanel = useCallback(
    (panelId: string, updates: Partial<Pick<Panel, "length" | "width">>) =>
      setQuote((q) => ({
        ...q,
        panels: q.panels.map((p) =>
          p.id === panelId ? normalizePanel({ ...p, ...updates }) : p,
        ),
      })),
    [],
  );

  const removePanel = useCallback((id: string) =>
    setQuote((q) => ({
      ...q,
      panels: q.panels.length > 1 ? q.panels.filter((p) => p.id !== id) : q.panels,
    })), []);

  const addPanel = useCallback(() => {
    const p = blankPanel("");
    setFreshId(p.id);
    setQuote((q) => ({ ...q, panels: [...q.panels, p] }));
    window.setTimeout(() => setFreshId(null), 700);
  }, []);

  const setSpecies = useCallback((species: SpeciesId) =>
    setQuote((q) => {
      const maxT = findSpecies(species).maxThicknessMm;
      return {
        ...q,
        species,
        panels: q.panels.map((p) =>
          p.thickness > maxT ? { ...p, thickness: maxT } : p,
        ),
      };
    }), []);
  const setFinish = useCallback((finish: FinishId) =>
    setQuote((q) => ({ ...q, finish })), []);
  const setShipping = useCallback((shipping: ShippingMode) =>
    setQuote((q) => ({ ...q, shipping })), []);
  const patchCustomer = useCallback(
    (updates: Partial<Quote["customer"]>) =>
      setQuote((q) => ({ ...q, customer: { ...q.customer, ...updates } })),
    [],
  );
  const setCutout = useCallback(
    (panelId: string, cutoutId: string, updates: Partial<Cutout>) =>
      setQuote((q) => ({
        ...q,
        panels: q.panels.map((p) => {
          if (p.id !== panelId) return p;
          const target = p.cutouts.find((c) => c.id === cutoutId);
          if (!target) return p;
          const others = p.cutouts.filter((c) => c.id !== cutoutId);
          const proposed: Cutout = { ...target, ...updates };
          const constrained = constrainCutout(
            proposed, target, others, p.length, p.width,
          );
          return {
            ...p,
            cutouts: p.cutouts.map((c) =>
              c.id === cutoutId ? constrained : c,
            ),
          };
        }),
      })),
    [],
  );

  const resetQuote = useCallback(() => {
    setQuote(defaultQuote()); // defaultQuote mints a fresh quoteNo
    window.location.hash = "";
  }, []);

  return (
    <div className="app">
      <a href="#controls" className="skip-link">Skip to controls</a>

      <header className="mast">
        <div className="mast__left">
          <img
            className="mast__logo"
            src="https://innatefurniture.co.nz/cdn/shop/files/Innate_Logo_Concept_1.png?width=360"
            alt="Innate Furniture"
          />
          <span className="mast__sep" aria-hidden>·</span>
          <span className="mast__title">Benchtops</span>
        </div>
        <div className="mast__right">
          <span className="mast__quote-label">Quote</span>
          <span className="mast__quote-no">{quote.quoteNo}</span>
        </div>
      </header>

      <main className="stage">
        <h1 className="stage__headline">Design your own solid timber benchtop</h1>

        {loadAdjustments.length > 0 && (
          <LoadAdjustmentNotice
            adjustments={loadAdjustments}
            onDismiss={() => setLoadAdjustments([])}
          />
        )}

        <div className="stage__preview">
          <SlabPreview
            panels={quote.panels}
            species={quote.species}
            finish={quote.finish}
            onCutoutChange={setCutout}
            onPanelChange={patchPanel}
          />
        </div>

        <div className="stage__controls" id="controls">
          <PanelEditor
            panels={quote.panels}
            species={quote.species}
            freshId={freshId}
            priceByPanelId={panelPriceMap(totals)}
            onUpdate={updatePanel}
            onRemove={removePanel}
            onAdd={addPanel}
            onCutoutChange={setCutout}
          />

          <TimberPicker value={quote.species} onChange={setSpecies} />
        </div>
      </main>

      <StickyBar
        totals={totals}
        shippingMode={quote.shipping}
        finish={quote.finish}
        leadTimeWeeks={totals.leadTimeWeeks}
        hasMainPanel={hasMainPanel}
        onFinishChange={setFinish}
        onShippingChange={setShipping}
        onRequest={() => setModalOpen(true)}
      />

      <QuoteForm
        open={modalOpen}
        quote={quote}
        totals={totals}
        onClose={() => setModalOpen(false)}
        onCustomerPatch={patchCustomer}
        onReset={resetQuote}
      />
    </div>
  );
}
