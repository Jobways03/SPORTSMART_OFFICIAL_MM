'use client';

import {
  LegalDocument,
  P,
  Defs,
  ContactCallout,
  type LegalSection,
} from '@/components/legal/LegalDocument';

/**
 * Privacy Policy — written, version-controlled legal page. Static route;
 * transparently overrides the /pages/[slug] CMS renderer for this exact path.
 */

const SECTIONS: LegalSection[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    body: (
      <div className="space-y-4">
        <P>
          Welcome to Sportsmart.com (“Platform”). At Sportsmart.com, we are committed to protecting
          your privacy and ensuring that your personal information is handled in a safe and
          responsible manner. This Privacy Policy outlines how we collect, use, disclose, and protect
          your data when you use our marketplace, which connects buyers and sellers.
        </P>
        <P>
          By accessing or using our Platform, you agree to this Privacy Policy. If you do not agree,
          please discontinue the use of our services.
        </P>
      </div>
    ),
  },
  {
    id: 'information-we-collect',
    title: 'Information We Collect',
    body: (
      <>
        <P>
          We collect different types of information to enhance your experience on our Platform. This
          includes:
        </P>
        <Defs
          items={[
            ['Personal Information', 'Name, email address, phone number, shipping address, billing address, payment details.'],
            ['Non-Personal Information', 'Browser type, IP address, device details, cookies, and browsing behavior.'],
            ['Transaction Information', 'Order details, purchase history, and payment records.'],
            ['Communication Information', 'Messages and interactions with customer support or sellers.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'how-we-collect-information',
    title: 'How We Collect Information',
    body: (
      <>
        <P>We gather information from various sources:</P>
        <Defs
          items={[
            ['Directly from You', 'When you register, make a purchase, or contact us.'],
            ['Automatically', 'Through cookies and tracking technologies when you browse the Platform.'],
            ['From Third Parties', 'Such as payment processors, logistics providers, and analytics partners.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'how-we-use-your-information',
    title: 'How We Use Your Information',
    body: (
      <>
        <P>Your information is used to:</P>
        <Defs
          items={[
            ['Facilitate Transactions', 'Process payments, manage orders, and coordinate shipping.'],
            ['Enhance User Experience', 'Personalize content, improve customer service, and analyze user behavior.'],
            ['Communicate Updates', 'Notify you about order status, promotions, and Platform changes.'],
            ['Ensure Security', 'Detect fraud, protect against unauthorized access, and enforce legal compliance.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'sharing-your-information',
    title: 'Sharing Your Information',
    body: (
      <>
        <P>We may share your data with:</P>
        <Defs
          items={[
            ['Sellers', 'To fulfill orders and provide customer support.'],
            ['Third-Party Service Providers', 'Payment processors, delivery services, and analytics companies.'],
            ['Legal Authorities', 'If required by law or to protect our rights.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'data-security',
    title: 'Data Security',
    body: (
      <P>
        We implement industry-standard security measures to safeguard your data against unauthorized
        access, alteration, disclosure, or destruction. However, no online platform is completely
        secure, and we cannot guarantee absolute protection.
      </P>
    ),
  },
  {
    id: 'user-rights',
    title: 'User Rights',
    body: (
      <>
        <P>
          Depending on your jurisdiction, you may have the following rights regarding your data:
        </P>
        <Defs
          items={[
            ['Access', 'Request a copy of your personal data.'],
            ['Correction', 'Modify incorrect or incomplete data.'],
            ['Deletion', 'Request the removal of your data, subject to legal limitations.'],
            ['Opt-Out', 'Decline marketing emails and certain tracking technologies.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'cookies-and-tracking',
    title: 'Cookies and Tracking Technologies',
    body: (
      <P>
        We use cookies to enhance user experience, analyze site traffic, and provide targeted
        advertisements. You can manage your cookie preferences through your browser settings.
      </P>
    ),
  },
  {
    id: 'changes-to-this-policy',
    title: 'Changes to This Privacy Policy',
    body: (
      <P>
        We may update this policy periodically. Changes will be posted on this page, and significant
        updates will be communicated through email or Platform notifications.
      </P>
    ),
  },
  {
    id: 'contact',
    title: 'Contact Information',
    body: (
      <ContactCallout
        intro="For any questions or concerns regarding this Privacy Policy, contact us at:"
        email="privacy@sportsmart.com"
      />
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      lead="This policy explains how Sportsmart.com collects, uses, and protects your personal information when you use our marketplace."
      lastUpdated="30 June 2026"
      sections={SECTIONS}
      contactEmail="privacy@sportsmart.com"
    />
  );
}
