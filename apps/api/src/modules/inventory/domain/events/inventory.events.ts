export const INVENTORY_EVENTS = {
  STOCK_RESERVED: 'inventory.stock.reserved',
  STOCK_RELEASED: 'inventory.stock.released',
  STOCK_DEDUCTED: 'inventory.stock.deducted',
  STOCK_ADJUSTED: 'inventory.stock.adjusted',
  STOCK_OUT_OF_STOCK: 'inventory.stock.out_of_stock',
  // Phase 54 (2026-05-21) — low-stock notification trigger. Fired
  // when LowStockAlertService creates a new ACTIVE alert (sweep or
  // event-driven path). Downstream subscribers wire email / Slack /
  // ops-channel notifications.
  LOW_STOCK_ALERT_TRIGGERED: 'inventory.low_stock_alert.triggered',
  LOW_STOCK_ALERT_RESOLVED: 'inventory.low_stock_alert.resolved',
} as const;
