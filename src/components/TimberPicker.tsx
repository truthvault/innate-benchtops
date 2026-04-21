import { SPECIES, type SpeciesId } from "../species";
import { formatNZD } from "../pricing";

interface Props {
  value: SpeciesId;
  onChange: (id: SpeciesId) => void;
}

export function TimberPicker({ value, onChange }: Props) {
  return (
    <section className="timber-picker" aria-labelledby="timber-h">
      <header className="section-head">
        <h2 id="timber-h">Timber</h2>
        <p className="section-sub">Three species, milled in Aotearoa.</p>
      </header>
      <div className="timber-picker__grid" role="radiogroup" aria-label="Timber species">
        {SPECIES.map((s) => {
          const on = s.id === value;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`timber-tile${on ? " is-on" : ""}`}
              onClick={() => onChange(s.id)}
            >
              <span className="timber-tile__photo">
                <img src={s.photo} alt="" loading="lazy" />
              </span>
              <span className="timber-tile__meta">
                <span className="timber-tile__name">{s.name}</span>
                <span className="timber-tile__origin">{s.origin}</span>
                <span className="timber-tile__rate">from {formatNZD(s.rateNZD)}/m²</span>
              </span>
              {on && (
                <svg viewBox="0 0 16 16" width="14" height="14" className="timber-tile__check" aria-hidden>
                  <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
