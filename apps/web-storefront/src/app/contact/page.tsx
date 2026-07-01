import type { Metadata } from 'next';
import { Mail, Phone, MapPin, Clock } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact us · Sportsmart',
  description:
    'Get in touch with Nova Sportsmart Private Limited — customer, seller and affiliate support, office addresses, and a contact form.',
};

// Phone / WhatsApp lines by audience. tel: strips spaces so the dialler gets a
// clean number.
const PHONES = [
  { label: 'Buyers', number: '+91 79812 65386' },
  { label: 'Sellers', number: '+91 92814 47747' },
  { label: 'Affiliates', number: '+91 92814 47747' },
];

const ADDRESSES = [
  {
    label: 'Address 1',
    lines:
      'Plot no: 52, Road no: 1, Sagar Housing Complex, BN Reddy Nagar, Saheb Nagar Kalan, Hyderabad, Ranga Reddy, Telangana 500070',
  },
  {
    label: 'Address 2',
    lines:
      'Unit No: 7-140/2, E 5, Left Portion, Nagendra Nagar, Scientist Colony, Habsiguda, Hyderabad - 500007',
  },
];

// Subtle brand wash + diagonal-stripe texture on the dark info panel — same
// treatment as the footer newsletter band so the two feel of one system.
const PANEL_WASH =
  'radial-gradient(ellipse 70% 70% at 100% 0%, rgba(220, 38, 38, 0.28), transparent 60%), radial-gradient(ellipse 70% 70% at 0% 100%, rgba(250, 204, 21, 0.14), transparent 60%)';
const PANEL_STRIPES =
  'repeating-linear-gradient(135deg, rgba(255,255,255,1) 0, rgba(255,255,255,1) 1px, transparent 1px, transparent 22px)';

function ChipItem({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="shrink-0 size-10 grid place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15 text-white">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="text-caption uppercase tracking-wider font-semibold text-white/55 mb-1">
          {label}
        </div>
        {children}
      </div>
    </li>
  );
}

export default function ContactPage() {
  return (
    <StorefrontShell>
      <div className="container-wide py-12 lg:py-16">
      {/* Header */}
      <header className="max-w-2xl">
        <span className="inline-flex items-center gap-2 h-6 px-2.5 bg-sale text-white text-caption uppercase tracking-[0.16em] font-bold rounded-full">
          We&apos;re here to help
        </span>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl text-ink-900">Contact us</h1>
        <p className="mt-3 text-body-lg text-ink-600">
          Questions, feedback, or need a hand? Reach the Sportsmart team below — we
          usually reply within one business day.
        </p>
      </header>

      {/* Info + form — one bordered unit so the two columns read as a pair */}
      <div className="mt-10 grid lg:grid-cols-5 rounded-3xl border border-ink-200 overflow-hidden shadow-sm">
        {/* Left — branded contact panel */}
        <aside className="lg:col-span-2 relative overflow-hidden bg-ink-900 text-white p-8 lg:p-10">
          <div aria-hidden className="absolute inset-0" style={{ backgroundImage: PANEL_WASH }} />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{ backgroundImage: PANEL_STRIPES }}
          />
          <div className="relative">
            <div className="text-caption uppercase tracking-[0.18em] font-semibold text-white/55 mb-2">
              Registered office
            </div>
            <p className="font-display text-2xl leading-tight text-white">
              Nova Sportsmart Private Limited
            </p>

            <ul className="mt-8 space-y-6">
              {ADDRESSES.map((a) => (
                <ChipItem key={a.label} icon={MapPin} label={a.label}>
                  <p className="text-body text-white/85 leading-relaxed">{a.lines}</p>
                </ChipItem>
              ))}

              <ChipItem icon={Mail} label="Email">
                <a
                  href="mailto:support@sportsmart.com"
                  className="text-body text-white/85 hover:text-gold transition-colors"
                >
                  support@sportsmart.com
                </a>
              </ChipItem>

              <ChipItem icon={Phone} label="Phone / WhatsApp">
                <ul className="space-y-1">
                  {PHONES.map((p) => (
                    <li key={p.label} className="text-body text-white/85">
                      <span className="text-white/55">{p.label}:</span>{' '}
                      <a
                        href={`tel:${p.number.replace(/\s/g, '')}`}
                        className="hover:text-gold transition-colors"
                      >
                        {p.number}
                      </a>
                    </li>
                  ))}
                </ul>
              </ChipItem>

              <ChipItem icon={Clock} label="Support timings">
                <p className="text-body text-white/85">
                  Monday&nbsp;–&nbsp;Saturday, 9:00&nbsp;AM&nbsp;–&nbsp;6:00&nbsp;PM (IST)
                </p>
              </ChipItem>
            </ul>
          </div>
        </aside>

        {/* Right — form */}
        <div className="lg:col-span-3 bg-white p-8 lg:p-10">
          <h2 className="font-display text-2xl text-ink-900">Send us a message</h2>
          <p className="mt-1 text-body text-ink-600">
            Fill in the form and we will get back to you.
          </p>
          <div className="mt-6">
            <ContactForm />
          </div>
        </div>
      </div>
      </div>
    </StorefrontShell>
  );
}
