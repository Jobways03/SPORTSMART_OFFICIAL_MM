'use client';

import Link from 'next/link';
import {
  LegalDocument,
  P,
  Defs,
  Bullets,
  Steps,
  Table,
  Callout,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Contact Us / Customer Support Policy — written, version-controlled legal page.
 * Static route; overrides the /pages/[slug] CMS renderer for this exact path.
 */

const link = 'text-accent-dark underline-offset-2 hover:underline';
const ADDRESS =
  'Plot no: 52, Road no: 1, Sagar Housing Complex, BN Reddy Nagar, Saheb Nagar Kalan, Hyderabad, Ranga Reddy, Telangana 500070';

const SECTIONS: LegalSection[] = [
  {
    id: 'contact-information',
    title: 'Contact Information',
    body: (
      <Table
        rows={[
          ['Business Name', 'Nova Sportsmart Private Limited'],
          ['Store / Trade Name', 'Sportsmart'],
          ['Email', <a key="e" href="mailto:support@sportsmart.com" className={link}>support@sportsmart.com</a>],
          ['Phone / WhatsApp', <a key="p" href="tel:+919059445503" className={link}>+91-9059445503</a>],
          ['Address', ADDRESS],
          ['Operating Hours', 'Monday – Sunday, 9:00 AM to 6:00 PM India Standard Time (IST)'],
        ]}
      />
    ),
  },
  {
    id: 'how-to-reach-us',
    title: 'How to Reach Us',
    body: (
      <Bullets
        items={[
          'Contact form on our website (share your name, preferred contact method, and reason for contact).',
          <>Email us at <a href="mailto:support@sportsmart.com" className={link}>support@sportsmart.com</a>.</>,
          <>Call or WhatsApp for urgent queries: <a href="tel:+919059445503" className={link}>+91-9059445503</a>.</>,
          'Social media or chat (if available) for general enquiries.',
        ]}
      />
    ),
  },
  {
    id: 'response-times',
    title: 'Response Times',
    body: (
      <>
        <Table
          head={['Type of Inquiry', 'Expected Response Time']}
          rows={[
            ['Order Status / Shipping Queries', '24–48 business hours'],
            ['Product / Size / Stock Questions', '48 business hours'],
            ['Returns, Refunds, Exchanges', '48–72 business hours (after all details are provided)'],
            ['Complaints / Escalation', 'Acknowledgement in 1–2 business days; resolution within 3–7 business days'],
          ]}
        />
        <P>
          <span className="font-semibold text-ink-900">Note:</span> If you contact us outside
          business hours, on weekends, or holidays, responses may take longer.
        </P>
      </>
    ),
  },
  {
    id: 'what-we-need-from-you',
    title: 'What We Need From You',
    body: (
      <Bullets
        items={[
          'Full name',
          'Order number / invoice number (if applicable)',
          'Preferred contact method (email / phone)',
          'Clear description of your query or issue',
          'Photos or screenshots for damaged/defective/incorrect items',
        ]}
      />
    ),
  },
  {
    id: 'what-we-will-do',
    title: 'What We Will Do',
    body: (
      <Bullets
        items={[
          'Acknowledge your query promptly',
          'Investigate and review the issue',
          'Provide updates if resolution needs more time',
          'Work toward a solution per our policies (returns/refunds/exchanges)',
        ]}
      />
    ),
  },
  {
    id: 'complaints-escalation',
    title: 'Complaints / Escalation',
    body: (
      <>
        <Steps
          items={[
            'Request escalation to a Manager / Supervisor.',
            'If unresolved, contact our Customer Grievance Redressal Officer:',
          ]}
        />
        <Callout>
          <p>
            <span className="font-semibold text-ink-900">Name:</span> Sudheer Panyam
          </p>
          <p>
            <span className="font-semibold text-ink-900">Email:</span>{' '}
            <a href="mailto:sudheer@sportsmart.com" className={link}>sudheer@sportsmart.com</a>
          </p>
          <p>
            <span className="font-semibold text-ink-900">Address:</span> {ADDRESS}
          </p>
          <p>We aim to resolve escalated complaints within 7 business days.</p>
        </Callout>
      </>
    ),
  },
  {
    id: 'privacy-and-data-protection',
    title: 'Privacy & Data Protection',
    body: (
      <>
        <P>
          We use your personal data (name, email, phone, order details) only to provide support,
          process your requests, and improve our services. For details, see our{' '}
          <Link href="/pages/privacy-policy" className={link}>Privacy Policy</Link>.
        </P>
        <P>
          We do not share your information with third parties except to process orders (e.g.,
          logistics partners, payment processors) or where required by law.
        </P>
      </>
    ),
  },
  {
    id: 'limitations',
    title: 'Limitations',
    body: (
      <Bullets
        items={[
          'Queries outside business hours may be delayed.',
          'Resolutions that involve third-party providers (couriers, vendors) depend on their timelines.',
          'International orders may face additional customs and shipping delays.',
        ]}
      />
    ),
  },
  {
    id: 'changes-to-this-policy',
    title: 'Changes to This Policy',
    body: (
      <P>
        We may update this page periodically. Any changes will appear here with a revised “Last
        updated” date.
      </P>
    ),
  },
];

export default function ContactUsPolicyPage() {
  return (
    <LegalDocument
      title="Contact Us / Customer Support Policy"
      org="Nova Sportsmart Private Limited"
      lead="This policy explains how you can reach us with questions, feedback, or complaints and how we handle your inquiries to ensure prompt, helpful, and courteous support for your Sportsmart shopping experience."
      lastUpdated="06/06/2026"
      sections={SECTIONS}
      contactEmail="support@sportsmart.com"
    />
  );
}
