import type { FinishId } from "../species";

interface Props {
  value: FinishId;
  onChange: (id: FinishId) => void;
}

export function FinishToggle({ value, onChange }: Props) {
  return (
    <section className="finish" aria-labelledby="finish-h">
      <header className="section-head">
        <h2 id="finish-h">Finish</h2>
      </header>
      <div className="seg" role="radiogroup" aria-label="Finish">
        <Opt on={value === "oiled"} onClick={() => onChange("oiled")} title="Sanded & oiled" sub="Food-safe hardwax oil. The standard finish." />
        <Opt on={value === "raw"} onClick={() => onChange("raw")} title="Raw, unsanded" sub="Timber as milled. Save 10%." />
      </div>
    </section>
  );
}

function Opt({
  on, onClick, title, sub,
}: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={`seg__opt${on ? " is-on" : ""}`}
      onClick={onClick}
    >
      <span className="seg__dot" aria-hidden />
      <span className="seg__text">
        <span className="seg__title">{title}</span>
        <span className="seg__sub">{sub}</span>
      </span>
    </button>
  );
}
