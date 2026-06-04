/**
 * Delhivery Client Warehouse — create + update wire shapes.
 *
 * Create:  `POST /api/backend/clientwarehouse/create/`
 * Update:  `POST /api/backend/clientwarehouse/edit/`
 *
 * `name` is case-sensitive and immutable — once a warehouse is
 * registered, only `phone`, `address`, `pin`, and `registered_name`
 * can be edited (per Delhivery's "Warehouse Updation" form). Tries to
 * change other fields (name, contact_person) are silently ignored.
 */

/* ─── Create ───────────────────────────────────────────────────── */

export interface DelhiveryWarehouseCreateRequest {
  /** Case-sensitive; used everywhere as `pickup_location.name`. */
  name: string;
  /** Optional registered legal name. */
  registered_name?: string;
  /** Optional contact person name — Delhivery panel "Contact Person Name". */
  contact_person?: string;
  /** Required. */
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  /** Required. String, not int (Delhivery expects "110042"). */
  pin: string;
  country?: string;
  /** Required — used for RTO. */
  return_address: string;
  return_pin?: string;
  return_city?: string;
  return_state?: string;
  return_country?: string;
}

/* ─── Update ───────────────────────────────────────────────────── */

/**
 * Only `name` is required; everything else is the field diff. Note
 * that `name` itself CANNOT change — it identifies the warehouse.
 */
export interface DelhiveryWarehouseUpdateRequest {
  /** Required — identifies the warehouse. NOT editable. */
  name: string;
  phone?: string;
  address?: string;
  pin?: string;
  /** Editable on update per Delhivery's "Warehouse Updation" form. */
  registered_name?: string;
}

/* ─── Response ─────────────────────────────────────────────────── */

export interface DelhiveryWarehouseResponse {
  status?: string;
  /** Delhivery echoes the warehouse name on success. */
  name?: string;
  /** Numeric ID Delhivery assigns. */
  id?: string | number;
  /** Failure detail. */
  error?: unknown;
  remarks?: string | string[];
}
