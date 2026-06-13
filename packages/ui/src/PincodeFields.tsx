'use client';

import './PincodeFields.css';
import {
  usePincodeLookup,
  type PincodeLookupResult,
} from './usePincodeLookup';

export interface PincodeValue {
  pincode: string;
  city: string;
  state: string;
  locality?: string;
  country?: string;
}

export interface PincodeFieldErrors {
  pincode?: string;
  city?: string;
  state?: string;
  country?: string;
  locality?: string;
}

/**
 * Reusable PIN-code → address auto-fill block, used across seller/franchise
 * onboarding and the profile pages.
 *
 * Type a 6-digit Indian PIN → auto-fills City/District + State (soft-green
 * "filled" wash, still editable), shows a `DISTRICT, STATE` hint, and offers a
 * Locality picker from the matching post offices. A previously-saved locality
 * is shown on load even before a fresh lookup.
 *
 * Controlled by the parent via `value`/`onChange`. Supports `disabled` (e.g.
 * while saving or under review) and per-field `errors`. The lookup itself comes
 * from the shared {@link usePincodeLookup} hook, so bespoke address forms (e.g.
 * the storefront checkout) can reuse the exact same behaviour with their own
 * markup.
 */
export function PincodeFields({
  value,
  onChange,
  showCountry = false,
  idPrefix,
  lookup,
  disabled = false,
  errors,
  forceLocality = false,
}: {
  value: PincodeValue;
  onChange: (patch: Partial<PincodeValue>) => void;
  showCountry?: boolean;
  idPrefix: string;
  lookup?: (pincode: string) => Promise<PincodeLookupResult | null>;
  disabled?: boolean;
  errors?: PincodeFieldErrors;
  /** Always render the Locality field (even before a lookup / with no saved
   *  value) — e.g. on the profile page so the option is always available. */
  forceLocality?: boolean;
}) {
  const {
    loading,
    error: lookupError,
    hint,
    places,
    autoFilled,
    lookup: runLookup,
  } = usePincodeLookup(lookup);

  async function onPincodeChange(raw: string) {
    const pincode = raw.replace(/\D/g, '').slice(0, 6);
    onChange({ pincode });
    const data = await runLookup(pincode);
    if (data?.district) {
      onChange({ city: data.district, state: data.state, locality: '' });
    }
  }

  const fieldClass = (filled: boolean) =>
    `pin__input${filled ? ' pin__input--filled' : ''}`;
  const err = (m?: string) =>
    m ? <span className="pin__note pin__note--err">{m}</span> : null;

  const showLocality = forceLocality || places.length > 0 || !!value.locality;

  return (
    <div className="pin">
      <div className="pin__grid">
        <div className="pin__field">
          <label htmlFor={`${idPrefix}-pincode`}>ZIP / PIN Code</label>
          <input
            id={`${idPrefix}-pincode`}
            value={value.pincode}
            onChange={(e) => onPincodeChange(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            placeholder="6-digit PIN"
            disabled={disabled}
          />
          {loading && <span className="pin__note">Looking up…</span>}
          {!loading && hint && <span className="pin__note pin__note--ok">{hint}</span>}
          {!loading && lookupError && (
            <span className="pin__note pin__note--err">{lookupError}</span>
          )}
          {err(errors?.pincode)}
        </div>

        {showCountry && (
          <div className="pin__field">
            <label htmlFor={`${idPrefix}-country`}>Country</label>
            <input
              id={`${idPrefix}-country`}
              value={value.country ?? 'India'}
              onChange={(e) => onChange({ country: e.target.value })}
              autoComplete="country-name"
              disabled={disabled}
            />
            {err(errors?.country)}
          </div>
        )}
      </div>

      <div className="pin__grid">
        <div className="pin__field">
          <label htmlFor={`${idPrefix}-city`}>City / District</label>
          <input
            id={`${idPrefix}-city`}
            className={fieldClass(autoFilled)}
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
            autoComplete="address-level2"
            disabled={disabled}
          />
          {err(errors?.city)}
        </div>
        <div className="pin__field">
          <label htmlFor={`${idPrefix}-state`}>State</label>
          <input
            id={`${idPrefix}-state`}
            className={fieldClass(autoFilled)}
            value={value.state}
            onChange={(e) => onChange({ state: e.target.value })}
            autoComplete="address-level1"
            disabled={disabled}
          />
          {err(errors?.state)}
        </div>
      </div>

      {showLocality && (
        <div className="pin__field">
          <label htmlFor={`${idPrefix}-locality`}>Locality</label>
          {places.length > 0 ? (
            <select
              id={`${idPrefix}-locality`}
              className={fieldClass(autoFilled)}
              value={value.locality ?? ''}
              onChange={(e) => onChange({ locality: e.target.value })}
              disabled={disabled}
            >
              <option value="">Select your locality</option>
              {places.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${idPrefix}-locality`}
              value={value.locality ?? ''}
              onChange={(e) => onChange({ locality: e.target.value })}
              disabled={disabled}
            />
          )}
          {err(errors?.locality)}
        </div>
      )}
    </div>
  );
}
