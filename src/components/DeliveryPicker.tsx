import { DELIVERY, type DeliveryId } from "../species";

interface Props {
  value: DeliveryId;
  address: string;
  onChange: (id: DeliveryId) => void;
  onAddressChange: (s: string) => void;
}

export function DeliveryPicker({ value, address, onChange, onAddressChange }: Props) {
  return (
    <section className="delivery" aria-labelledby="delivery-h">
      <header className="section-head">
        <h2 id="delivery-h">Delivery</h2>
      </header>
      <div className="seg seg--stack" role="radiogroup" aria-label="Delivery">
        {DELIVERY.map((d) => {
          const on = d.id === value;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`seg__opt${on ? " is-on" : ""}`}
              onClick={() => onChange(d.id)}
            >
              <span className="seg__dot" aria-hidden />
              <span className="seg__text">
                <span className="seg__title">{d.label}</span>
                <span className="seg__sub">{d.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {value === "nationwide" && (
        <label className="delivery__address">
          <span className="numfield__label">Delivery address <em>(optional — for quote)</em></span>
          <input
            type="text"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Street, suburb, city"
            autoComplete="street-address"
          />
        </label>
      )}
    </section>
  );
}
