/**
 * Re-export the contract package's shipment-related schemas so module
 * consumers can import "../dto" instead of reaching across the
 * workspace. Mirrors apps/api/src/modules/<x>/application/dto layout.
 */
export {
  CreateShipmentRequest,
  CreateShipmentResponse,
  CancelShipmentRequest,
  ShipmentResponse,
  ShipmentStatus,
  AddressSnapshot,
  ShipmentItem,
  PaiseAmount,
} from '@sportsmart/logistics-contracts';
