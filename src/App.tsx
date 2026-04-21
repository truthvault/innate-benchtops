import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cutout, Panel, Quote } from "./pricing";
import { panelPriceMap, priceQuote } from "./pricing";
import type { ShippingMode } from "./shipping";
import {
  blankPanel,
  defaultQuote,
  loadInitial,
  persist,
} from "./state";
import { findSpecies, type FinishId, type SpeciesId } from "./species";
import { SlabPreview } from "./components/SlabPreview";
import { PanelEditor } from "./components/PanelEditor";
import { TimberPicker } from "./components/TimberPicker";
import { StickyBar } from "./components/StickyBar";
import { QuoteForm } from "./components/QuoteForm";

export default function App() {
  const [quote, setQuote] = useState<Quote>(() => loadInitial());
  const [freshId, setFreshId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => { persist(quote); }, [quote]);

  const totals = useMemo(() => priceQuote(quote), [quote]);

  const updatePanel = useCallback((id: string, next: Panel) =>
    setQuote((q) => ({ ...q, panels: q.panels.map((p) => (p.id === id ? next : p)) })), []);

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
        panels: q.panels.map((p) =>
          p.id !== panelId
            ? p
            : {
                ...p,
                cutouts: p.cutouts.map((c) =>
                  c.id === cutoutId ? { ...c, ...updates } : c,
                ),
              },
        ),
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
          <span className="mast__brand">INNATE</span>
          <span className="mast__sep" aria-hidden>·</span>
          <span className="mast__title">Benchtops</span>
        </div>
        <div className="mast__right">
          <span className="mast__quote-label">Quote</span>
          <span className="mast__quote-no">{quote.quoteNo}</span>
        </div>
      </header>

      <main className="stage">
        <div className="stage__preview">
          <SlabPreview
            panels={quote.panels}
            species={quote.species}
            finish={quote.finish}
            onCutoutChange={setCutout}
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
