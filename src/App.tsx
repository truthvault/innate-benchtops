import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cutout, Panel, Quote } from "./pricing";
import { priceQuote } from "./pricing";
import {
  blankPanel,
  defaultQuote,
  loadInitial,
  persist,
  quoteNumber,
} from "./state";
import { findSpecies, type DeliveryId, type FinishId, type SpeciesId } from "./species";
import { SlabPreview } from "./components/SlabPreview";
import { PanelEditor } from "./components/PanelEditor";
import { TimberPicker } from "./components/TimberPicker";
import { FinishToggle } from "./components/FinishToggle";
import { DeliveryPicker } from "./components/DeliveryPicker";
import { StickyBar } from "./components/StickyBar";
import { QuoteForm } from "./components/QuoteForm";

export default function App() {
  const [quote, setQuote] = useState<Quote>(() => loadInitial());
  const [freshId, setFreshId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => { persist(quote); }, [quote]);

  const totals = useMemo(() => priceQuote(quote), [quote]);

  const [session, setSession] = useState(() => {
    const seed = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
    return { seed, quoteNo: quoteNumber(seed) };
  });

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
  const setDelivery = useCallback((delivery: DeliveryId) =>
    setQuote((q) => ({ ...q, delivery })), []);
  const setAddress = useCallback((address: string) =>
    setQuote((q) => ({ ...q, address })), []);
  const setCustomer = useCallback((customer: Quote["customer"]) =>
    setQuote((q) => ({ ...q, customer })), []);
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
    const seed = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
    setSession({ seed, quoteNo: quoteNumber(seed) });
    setQuote(defaultQuote());
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
          <span className="mast__quote-no">{session.quoteNo}</span>
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
            onUpdate={updatePanel}
            onRemove={removePanel}
            onAdd={addPanel}
            onCutoutChange={setCutout}
          />

          <TimberPicker value={quote.species} onChange={setSpecies} />

          <FinishToggle value={quote.finish} onChange={setFinish} />

          <DeliveryPicker
            value={quote.delivery}
            address={quote.address}
            onChange={setDelivery}
            onAddressChange={setAddress}
          />

          <footer className="fineprint">
            <p>
              All prices include GST. Timber is milled and finished in Ōtautahi Christchurch.
              Lead times shift with season and workshop queue — we'll confirm exactly when you quote.
            </p>
          </footer>
        </div>
      </main>

      <StickyBar
        grand={totals.grand}
        belowMinimum={totals.belowMinimum}
        onRequest={() => setModalOpen(true)}
      />

      <QuoteForm
        open={modalOpen}
        quote={quote}
        totals={totals}
        quoteNo={session.quoteNo}
        onClose={() => setModalOpen(false)}
        onCustomerChange={setCustomer}
        onReset={resetQuote}
      />
    </div>
  );
}
