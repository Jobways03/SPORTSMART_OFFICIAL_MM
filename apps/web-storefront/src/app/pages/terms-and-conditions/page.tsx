'use client';

import {
  LegalDocument,
  P,
  Defs,
  Bullets,
  ContactCallout,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Terms and Conditions — written, version-controlled legal page. Static route;
 * transparently overrides the /pages/[slug] CMS renderer for this exact path.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    body: (
      <P>
        Welcome to Sportsmart.com (“Platform”). By using our services, you agree to be bound by these
        Terms and Conditions (“Terms”). If you do not agree, please refrain from using our Platform.
      </P>
    ),
  },
  {
    id: 'definitions',
    title: 'Definitions',
    body: (
      <Defs
        items={[
          ['Platform', 'Sportsmart.com, acting as an aggregator between buyers and sellers.'],
          ['User', 'Any individual or business accessing or using the Platform.'],
          ['Buyer', 'An individual purchasing products through the Platform.'],
          ['Seller', 'A vendor listing and selling products on the Platform.'],
          ['Aggregator', 'Sportsmart.com, providing the platform for transactions but not directly selling goods.'],
          ['Order', 'A transaction where a Buyer purchases a Seller’s product through the Platform.'],
        ]}
      />
    ),
  },
  {
    id: 'user-accounts',
    title: 'User Accounts',
    body: (
      <Defs
        items={[
          ['Registration', 'Users must register an account to access Platform features.'],
          ['Account Security', 'Users must maintain confidentiality of their login details.'],
          ['Account Termination', 'The Platform reserves the right to suspend or terminate accounts violating these Terms.'],
        ]}
      />
    ),
  },
  {
    id: 'seller-obligations',
    title: 'Seller Obligations',
    body: (
      <Defs
        items={[
          ['Product Listings', 'Sellers must provide accurate descriptions, images, and prices for their products.'],
          ['Inventory Management', 'Sellers are responsible for updating stock levels.'],
          ['Compliance', 'Sellers must adhere to all applicable laws and regulations.'],
          ['Order Fulfillment', 'Sellers must process and ship orders promptly using approved shipping methods.'],
          ['Returns and Refunds', 'Sellers must provide a clear return and refund policy and process claims in accordance with applicable laws.'],
        ]}
      />
    ),
  },
  {
    id: 'buyer-obligations',
    title: 'Buyer Obligations',
    body: (
      <Defs
        items={[
          ['Accurate Information', 'Buyers must provide accurate and up-to-date shipping and contact information.'],
          ['Payments', 'Buyers agree to pay for products, including any applicable taxes and shipping fees.'],
          ['Return Requests', 'Buyers must follow the Seller’s return policy before requesting a refund.'],
        ]}
      />
    ),
  },
  {
    id: 'fees-and-commissions',
    title: 'Fees and Commissions',
    body: (
      <Defs
        items={[
          ['Commission Structure', 'The Platform charges Sellers a commission per sale, as specified in our Commission Policy.'],
          ['Payment Gateway Charges', 'Transactions are subject to third-party payment processing fees.'],
          ['Withdrawal of Funds', 'Seller payouts will be processed as per the Platform’s payment cycle, subject to deductions for fees and commissions.'],
        ]}
      />
    ),
  },
  {
    id: 'order-processing-and-fulfillment',
    title: 'Order Processing and Fulfillment',
    body: (
      <Defs
        items={[
          ['Order Confirmation', 'Once an order is placed, Sellers are notified to process and fulfill it.'],
          ['Shipping Responsibilities', 'Sellers are responsible for shipping the product to the Buyer’s address.'],
          ['Delivery Timelines', 'Estimated shipping and delivery times should be clearly mentioned by Sellers.'],
        ]}
      />
    ),
  },
  {
    id: 'shipping-and-delivery',
    title: 'Shipping and Delivery',
    body: (
      <Defs
        items={[
          ['Logistics Partners', 'Sellers may use third-party courier services, including Shiprocket, Delhivery, Bluedart, etc.'],
          ['Tracking Information', 'Sellers must provide Buyers with order tracking details.'],
          ['Delayed Shipments', 'The Platform is not responsible for delays caused by logistics providers.'],
        ]}
      />
    ),
  },
  {
    id: 'returns-refunds-and-cancellations',
    title: 'Returns, Refunds, and Cancellations',
    body: (
      <Defs
        items={[
          ['Seller Responsibility', 'Each Seller is responsible for defining their return and refund policies.'],
          ['Buyer Eligibility', 'Buyers must initiate return requests within the timeframe specified by the Seller.'],
          ['Refund Process', 'Approved refunds will be processed via the original payment method.'],
          ['Cancellation Requests', 'Buyers may cancel orders before they are shipped. Once dispatched, cancellations are subject to the Seller’s return policy.'],
        ]}
      />
    ),
  },
  {
    id: 'dispute-resolution',
    title: 'Dispute Resolution',
    body: (
      <Defs
        items={[
          ['Between Buyers and Sellers', 'Users should attempt to resolve disputes amicably.'],
          ['Platform Mediation', 'The Platform may mediate disputes but is not liable for transactions between Buyers and Sellers.'],
          ['Legal Recourse', 'If disputes cannot be resolved, parties may seek legal remedies under applicable laws.'],
        ]}
      />
    ),
  },
  {
    id: 'intellectual-property',
    title: 'Intellectual Property',
    body: (
      <Defs
        items={[
          ['Ownership', 'All content on the Platform, including logos, product images, and descriptions, is owned by the respective Sellers or the Platform.'],
          ['Restrictions', 'Users may not copy, reproduce, or distribute any content without prior authorization.'],
        ]}
      />
    ),
  },
  {
    id: 'liability-limitation',
    title: 'Liability Limitation',
    body: (
      <>
        <P>The Platform is not liable for:</P>
        <Bullets
          items={[
            'Misrepresentation or inaccuracies in product descriptions.',
            'Delayed, lost, or damaged shipments.',
            'Non-fulfillment of orders by Sellers.',
            'Any direct or indirect losses incurred by Users.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'indemnification',
    title: 'Indemnification',
    body: (
      <P>
        Users agree to indemnify and hold harmless Sportsmart.com from any claims, damages, or legal
        expenses arising from their use of the Platform.
      </P>
    ),
  },
  {
    id: 'termination-of-services',
    title: 'Termination of Services',
    body: (
      <>
        <P>The Platform reserves the right to:</P>
        <Bullets
          items={[
            'Remove any Seller or Buyer violating these Terms.',
            'Suspend accounts engaged in fraudulent activities.',
            'Modify or discontinue Platform services at any time.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'governing-law-and-jurisdiction',
    title: 'Governing Law and Jurisdiction',
    body: (
      <Bullets
        items={[
          'These Terms are governed by the laws of Hyderabad, Telangana state.',
          'Any disputes will be subject to the jurisdiction of the courts in Hyderabad.',
        ]}
      />
    ),
  },
  {
    id: 'modifications',
    title: 'Modifications to Terms and Conditions',
    body: (
      <Bullets
        items={[
          'The Platform reserves the right to update these Terms periodically.',
          'Users will be notified of significant changes via email or Platform notifications.',
          'Continued use of the Platform after modifications constitutes acceptance of the updated Terms.',
        ]}
      />
    ),
  },
  {
    id: 'contact',
    title: 'Contact Information',
    body: (
      <ContactCallout
        intro="For any queries, complaints, or support requests, Users can contact us at:"
        email="support@sportsmart.com"
      />
    ),
  },
];

export default function TermsAndConditionsPage() {
  return (
    <LegalDocument
      title="Terms and Conditions"
      lead="These terms govern the use of the Sportsmart.com marketplace by buyers and sellers. Please read them carefully before using the Platform."
      lastUpdated="30 June 2026"
      sections={SECTIONS}
      contactEmail="support@sportsmart.com"
    />
  );
}
