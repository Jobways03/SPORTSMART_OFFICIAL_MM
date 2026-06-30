'use client';

import {
  LegalDocument,
  P,
  Defs,
  Bullets,
  SubHead,
  Table,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Product Packing Policy — written, version-controlled legal page. Static
 * route; transparently overrides the /pages/[slug] CMS renderer for this path.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'purpose',
    title: 'Purpose',
    body: (
      <P>
        This policy ensures that all products sold through Sportsmart.com are packed securely and
        professionally to prevent damage, reduce returns, and maintain customer satisfaction.
      </P>
    ),
  },
  {
    id: 'general-packaging-requirements',
    title: 'General Packaging Requirements',
    body: (
      <Bullets
        items={[
          'Every product must be inspected before packing to ensure it is clean, undamaged, and includes all necessary accessories.',
          'Old labels, barcodes, or price tags must be removed before shipping.',
          'A printed invoice must be included inside the package.',
        ]}
      />
    ),
  },
  {
    id: 'packing-material-standards',
    title: 'Packing Material Standards',
    body: (
      <>
        <Table
          head={['Product Type', 'Packaging Material Required']}
          rows={[
            ['Sports Equipment (Bats, Balls, Gloves, Pads)', 'Corrugated Cardboard Box + Bubble Wrap + Waterproof Layer'],
            ['Apparel (Jerseys, Shorts, Socks)', 'Polybags or Zipper Pouches'],
            ['Fragile Items (Helmets, Glass Equipment)', 'Double Layer Bubble Wrap + Foam Sheets + Cardboard Box'],
            ['High-Value Items (Branded Kits, Custom Equipment)', 'Air Pillows + Hard Cardboard Box'],
          ]}
        />
        <SubHead>Additional Packing Guidelines</SubHead>
        <Defs
          items={[
            ['Fragile items', 'Must be packed with extra cushioning, and “FRAGILE” labels should be used.'],
            ['Heavy or bulky items', 'Reinforced boxes and extra sealing tape should be used.'],
            ['Waterproofing', 'Use waterproof material to protect against moisture during transit.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'labeling-and-shipping-instructions',
    title: 'Labeling & Shipping Instructions',
    body: (
      <Bullets
        items={[
          'The shipping label must be clearly printed and securely attached to a flat surface for easy scanning.',
          'Products requiring special handling (fragile, heavyweight, perishable) must have appropriate stickers or labels.',
          'Every package must have tracking information updated immediately upon dispatch.',
        ]}
      />
    ),
  },
  {
    id: 'shipping-and-handling',
    title: 'Shipping & Handling',
    body: (
      <>
        <P>Sellers must dispatch orders within the agreed timeframe to avoid delays.</P>
        <P>If using self-shipping, sellers must:</P>
        <Bullets
          items={[
            'Choose a reliable shipping provider (e.g., Shiprocket, Delhivery).',
            'Update tracking details in the seller dashboard immediately after dispatch.',
          ]}
        />
        <P>
          If using Sportsmart’s preferred logistics partner, all packages must adhere to platform
          shipping guidelines.
        </P>
      </>
    ),
  },
  {
    id: 'returns-and-damage-prevention',
    title: 'Returns & Damage Prevention',
    body: (
      <>
        <P>
          Packaging must be strong enough to withstand return transit. Poor packaging resulting in
          product damage may lead to penalties or return costs being borne by the seller.
        </P>
        <P>
          If a product is returned due to poor packing or incorrect product shipment, the seller will
          bear the return shipping costs.
        </P>
      </>
    ),
  },
  {
    id: 'non-compliance-consequences',
    title: 'Non-Compliance Consequences',
    body: (
      <Bullets
        items={[
          'Customer complaints & negative reviews affecting seller performance.',
          'Penalties for repeat packaging failures leading to product damage.',
          'Suspension or delisting of seller accounts for continued violations.',
        ]}
      />
    ),
  },
  {
    id: 'best-practices',
    title: 'Best Practices for Sellers',
    body: (
      <Bullets
        items={[
          'Use strong packing tape to seal all sides of the box securely.',
          'Avoid oversized boxes — use the correct box size to prevent movement inside.',
          'Double-check labeling before dispatch to avoid misrouted shipments.',
        ]}
      />
    ),
  },
];

export default function ProductPolicyPage() {
  return (
    <LegalDocument
      title="Product Packing Policy"
      lead="How sellers must pack and ship products on Sportsmart.com to prevent damage, reduce returns, and keep customers satisfied."
      lastUpdated="30 June 2026"
      sections={SECTIONS}
      contactEmail="support@sportsmart.com"
    />
  );
}
