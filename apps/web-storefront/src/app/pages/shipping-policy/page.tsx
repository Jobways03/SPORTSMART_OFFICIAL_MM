'use client';

import {
  LegalDocument,
  P,
  Defs,
  SubHead,
  ContactCallout,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Shipping Policy — written, version-controlled legal page. Static route;
 * overrides the /pages/[slug] CMS renderer for this exact path.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'order-processing-time',
    title: 'Order Processing Time',
    body: (
      <Defs
        items={[
          ['Standard Processing', 'Orders are typically processed within 2–3 business days after payment confirmation.'],
          ['Weekends and Holidays', 'Orders placed on weekends or public holidays will be processed on the next business day.'],
        ]}
      />
    ),
  },
  {
    id: 'shipping-methods-and-delivery-times',
    title: 'Shipping Methods and Delivery Times',
    body: (
      <>
        <SubHead>For Domestic Shipping (Within India)</SubHead>
        <Defs
          items={[
            ['Standard Shipping', 'Delivery within 5–7 business days.'],
            ['Express Shipping', 'Delivery within 2–3 business days.'],
          ]}
        />
        <P>
          <span className="font-semibold text-ink-900">Note:</span> Delivery times may vary based on
          destination and unforeseen circumstances.
        </P>
      </>
    ),
  },
  {
    id: 'order-tracking',
    title: 'Order Tracking',
    body: (
      <Defs
        items={[
          ['Tracking Information', 'Once shipped, a tracking number will be emailed to you.'],
          ['Tracking Updates', 'Monitor your shipment status through our Order Tracking Number.'],
        ]}
      />
    ),
  },
  {
    id: 'shipping-restrictions',
    title: 'Shipping Restrictions',
    body: (
      <Defs
        items={[
          ['P.O. Boxes', 'We do not ship to P.O. Box addresses.'],
          ['Military Addresses', 'Shipping to military addresses may have specific restrictions and longer delivery times.'],
        ]}
      />
    ),
  },
  {
    id: 'delayed-or-lost-orders',
    title: 'Delayed or Lost Orders',
    body: (
      <Defs
        items={[
          ['Delayed Shipments', 'If your order is delayed beyond the estimated delivery time, please contact our customer support.'],
          ['Lost Orders', 'If your order is confirmed lost, we will offer a replacement or full refund.'],
        ]}
      />
    ),
  },
  {
    id: 'damaged-or-incorrect-orders',
    title: 'Damaged or Incorrect Orders',
    body: (
      <Defs
        items={[
          ['Damaged Items', 'If you receive a damaged product, contact us within 48 hours of delivery with photos of the damage.'],
          ['Incorrect Items', 'If you receive the wrong item, please notify us within 48 hours for a replacement or refund.'],
        ]}
      />
    ),
  },
  {
    id: 'contact',
    title: 'Contact Information',
    body: (
      <ContactCallout
        intro="For any shipping-related inquiries, please contact our customer service team:"
        email="support@sportsmart.com"
      />
    ),
  },
];

export default function ShippingPolicyPage() {
  return (
    <LegalDocument
      title="Shipping Policy"
      lead="How and when your Sportsmart.com orders are processed, shipped, tracked, and delivered."
      lastUpdated="30 June 2026"
      sections={SECTIONS}
      contactEmail="support@sportsmart.com"
    />
  );
}
