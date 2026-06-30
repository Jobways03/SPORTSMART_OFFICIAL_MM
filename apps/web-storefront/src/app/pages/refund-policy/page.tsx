'use client';

import {
  LegalDocument,
  P,
  Defs,
  Bullets,
  Steps,
  SubHead,
  ContactCallout,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Return, Refund & Exchange Policy — written, version-controlled legal page.
 * Static route; overrides the /pages/[slug] CMS renderer for this exact path.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <P>
        At Sportsmart.com, we are committed to providing high-quality sports equipment and apparel.
        We understand that occasionally a product may not meet your expectations or requirements. Our
        policy prioritizes exchanges to ensure you receive the right product, with refunds offered in
        specific circumstances.
      </P>
    ),
  },
  {
    id: 'exchange-policy',
    title: 'Exchange Policy',
    body: (
      <>
        <SubHead>Eligibility</SubHead>
        <P>Customers may request an exchange within 7 days of receiving the product. To qualify:</P>
        <Bullets
          items={[
            'The item must be unused, unwashed, and in its original packaging with all tags intact.',
            'Proof of purchase, such as a receipt or order confirmation, is required.',
          ]}
        />
        <SubHead>Process</SubHead>
        <Steps
          items={[
            ['Initiate Exchange', 'Contact our customer service at support@sportsmart.com with your order number and reason for the exchange.'],
            ['Authorization', 'Our team will provide an exchange authorization and instructions for returning the item.'],
            ['Return Shipment', 'Ship the item back as per the provided instructions. Ensure the product is securely packaged to prevent damage during transit.'],
            ['Processing', 'Upon receiving and inspecting the returned item, we will dispatch the replacement product.'],
          ]}
        />
        <SubHead>Shipping Costs</SubHead>
        <P>
          For exchanges due to personal preferences (e.g., size or color changes), the customer is
          responsible for return shipping costs. If the exchange is due to a defect or error on our
          part, we will cover the shipping expenses.
        </P>
      </>
    ),
  },
  {
    id: 'refund-policy',
    title: 'Refund Policy',
    body: (
      <>
        <SubHead>Eligibility</SubHead>
        <P>
          Refunds are offered only for products that are defective, damaged upon arrival, or if the
          wrong item was shipped.
        </P>
        <SubHead>Process</SubHead>
        <Steps
          items={[
            ['Initiate Refund', 'Contact our customer service within 7 days of receiving the product at support@sportsmart.com with your order number and details of the issue.'],
            ['Authorization', 'Our team will provide a return authorization and instructions for returning the item.'],
            ['Return Shipment', 'Ship the item back following the provided instructions. Ensure the product is securely packaged.'],
            ['Processing', 'Once we receive and inspect the returned item, a refund will be issued to your original payment method within 10 business days.'],
          ]}
        />
        <SubHead>Conditions</SubHead>
        <Bullets
          items={[
            'The product must be returned in its original condition.',
            'Certain items, such as customized or personalized products, are non-refundable unless defective.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'non-returnable-items',
    title: 'Non-Returnable Items',
    body: (
      <>
        <P>
          Due to hygiene and safety considerations, certain items cannot be returned or exchanged
          unless they are defective or damaged. These include:
        </P>
        <Bullets
          items={[
            'Personal protective equipment (e.g., mouthguards, helmets).',
            'Undergarments and swimwear.',
            'Customized or personalized products.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'important-considerations',
    title: 'Important Considerations',
    body: (
      <Defs
        items={[
          ['Proof of Purchase', 'A valid receipt or order confirmation is required for all returns and exchanges.'],
          ['Condition of Items', 'Returned items must be unused, unwashed, and in their original packaging.'],
          ['Processing Time', 'Exchanges and refunds are processed within 10 business days upon receiving the returned item.'],
        ]}
      />
    ),
  },
  {
    id: 'contact',
    title: 'Contact Us',
    body: (
      <ContactCallout
        intro="For any questions or assistance regarding returns, refunds, or exchanges, please contact our customer service team:"
        email="support@sportsmart.com"
      />
    ),
  },
];

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      title="Return, Refund & Exchange Policy"
      lead="How returns, refunds, and exchanges work at Sportsmart.com — we prioritize exchanges so you get the right product, with refunds offered in specific cases."
      lastUpdated="30 June 2026"
      sections={SECTIONS}
      contactEmail="support@sportsmart.com"
    />
  );
}
