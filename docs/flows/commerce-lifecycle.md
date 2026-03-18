# Commerce Lifecycle Flows

## Flow A: Cart -> Checkout Validation
Owner: checkout
1. checkout gets cart snapshot from cart
2. checkout asks catalog for product/variant validation
3. checkout asks seller for active/eligible status
4. checkout asks inventory to validate stock
5. checkout asks cod for COD decision (if applicable)
6. checkout asks franchise for pincode mapping
7. checkout optionally asks affiliate for attribution
8. checkout calculates final validation result
9. checkout creates checkout session/intent
10. checkout may reserve inventory

## Flow B: Checkout Submit -> Order Creation
Owner: checkout -> orders
1. Customer confirms checkout
2. checkout re-validates critical conditions
3. checkout asks inventory to reserve stock
4. checkout calls orders.createOrderFromCheckout()
5. orders creates master order + sub-orders + line snapshots
6. orders emits orders.master.created + orders.sub_order.created
7. Online: checkout/orders requests payments.createPaymentIntent()
8. COD: order marked with COD decision snapshot
9. cart cleared after successful order creation

## Flow C: Online Payment Success
Owner: payments -> orders
1. Payment gateway webhook hits payments
2. payments verifies signature + idempotency
3. payments marks payment captured
4. payments emits payments.captured
5. orders confirms order payment state
6. orders moves order/sub-orders to next state
7. inventory gets confirm-deduct
8. notifications sends order confirmation
9. settlements may record initial payable basis

## Flow D: Seller Fulfillment + Shipment
Owner: shipping + orders
1. Seller accepts sub-order via seller portal
2. orders transitions sub-order state
3. Seller/admin triggers shipment creation
4. shipping gets context from orders + seller
5. shipping calls Shiprocket adapter
6. shipping stores AWB/label/shipment
7. shipping emits shipping.shipment.created + shipping.awb.assigned
8. orders updates sub-order shipping state
9. notifications sends shipment update

## Flow E: Tracking / NDR / RTO
Owner: shipping
1. Shiprocket webhook/polling data reaches shipping
2. shipping normalizes external payload
3. shipping updates shipment timeline/state
4. shipping emits tracking/NDR/RTO events
5. orders updates business status from normalized event
6. returns may react for RTO handling
7. settlements may record RTO adjustment
8. notifications sends messages

## Flow F: Return Initiation
Owner: returns
1. Customer requests return
2. returns asks orders for order line + delivery context
3. returns asks catalog for return metadata
4. returns checks return policy matrix
5. If eligible, return request created
6. returns may ask shipping for reverse pickup
7. returns emits returns.requested
8. Seller/admin reviews per policy

## Flow G: QC + Refund/Adjustment Decision
Owner: returns -> payments + settlements
1. Returned item received
2. QC evidence uploaded via files
3. returns records QC outcome
4. If refund: returns calls payments.requestRefund()
5. If seller adjustment: returns calls settlements.recordLedgerImpact()
6. returns emits returns.qc.completed + refund/adjustment events
7. affiliate/franchise reversal may trigger
8. notifications sent

## Flow H: Weekly Seller Settlement
Owner: settlements
1. Scheduler/admin triggers preview
2. settlements pulls signals from orders, payments, returns, affiliate, franchise, seller
3. settlements computes ledger entries + net payable
4. Preview created
5. Admin reviews and approves
6. Payout statement generated
7. settlements.run.approved emitted
8. Seller notified
