'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Mail, ArrowRight, Truck, RotateCcw, ShieldCheck, MessageCircle } from 'lucide-react';

const InstagramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <path d="M16 11.37a4 4 0 1 1-7.91 1.18 4 4 0 0 1 7.91-1.18Z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const FacebookIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const TwitterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const YoutubeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
  </svg>
);

const VALUE_PROPS = [
  { icon: Truck,        title: 'Free shipping',    desc: 'On orders over ₹999' },
  { icon: RotateCcw,    title: '7-day returns',    desc: 'Doorstep pickup' },
  { icon: ShieldCheck,  title: '100% authentic',   desc: 'Direct from brands' },
  { icon: MessageCircle, title: '24/7 support',     desc: 'We’re always on' },
];

const SHOP_LINKS = [
  { label: 'New arrivals',   href: '/products?sortBy=newest' },
  { label: 'Best sellers',   href: '/products?sortBy=popular' },
  { label: 'Sale',           href: '/products?onSale=true' },
  { label: 'All brands',     href: '/products?view=brands' },
  { label: 'Shop by sport',  href: '/products?view=sports' },
];

const HELP_LINKS = [
  { label: 'Track order',         href: '/orders' },
  { label: 'Returns & refunds',   href: '/returns' },
  { label: 'Shipping info',       href: '/help/shipping' },
  { label: 'Size guide',          href: '/help/size-guide' },
  { label: 'Contact us',          href: '/help/contact' },
];

const ABOUT_LINKS = [
  { label: 'Our story',         href: '/about' },
  { label: 'Become a seller',   href: '/sellers' },
  { label: 'Affiliate program', href: '/affiliate' },
  { label: 'Careers',           href: '/careers' },
  { label: 'Press & media',     href: '/press' },
];

const LEGAL_LINKS = [
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Terms',   href: '/legal/terms' },
  { label: 'Returns', href: '/legal/returns' },
  { label: 'Cookies', href: '/legal/cookies' },
];

const PAYMENT_METHODS = ['Visa', 'Mastercard', 'Rupay', 'UPI', 'Net Banking', 'COD'];

// Headline brands for the "Top brands on Sportsmart" pipe strip — keep ~10
// for one clean wrap on desktop. Slugs power the /products?brand=x filter.
const TOP_BRANDS = [
  { label: 'Nike',     slug: 'nike' },
  { label: 'Adidas',   slug: 'adidas' },
  { label: 'Puma',     slug: 'puma' },
  { label: 'SG',       slug: 'sg' },
  { label: 'SS',       slug: 'ss' },
  { label: 'MRF',      slug: 'mrf' },
  { label: 'Yonex',    slug: 'yonex' },
  { label: 'Cosco',    slug: 'cosco' },
  { label: 'Nivia',    slug: 'nivia' },
  { label: 'Kookaburra', slug: 'kookaburra' },
  { label: 'Wilson',   slug: 'wilson' },
  { label: 'Asics',    slug: 'asics' },
];

export function Footer() {
  return (
    <footer className="bg-ink-900 text-white mt-16 border-t-4 border-sale">
      {/* Newsletter band — black with subtle red+gold radial wash */}
      <div
        className="border-b border-white/10 relative overflow-hidden"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 60% at 90% 0%, rgba(220, 38, 38, 0.32), transparent 60%), radial-gradient(ellipse 60% 60% at 10% 100%, rgba(250, 204, 21, 0.18), transparent 60%)',
        }}
      >
        {/* Repeating diagonal stripe pattern — distinctive athletic texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, rgba(255,255,255,1) 0, rgba(255,255,255,1) 1px, transparent 1px, transparent 24px)',
          }}
        />
        <div className="relative container-wide py-12 lg:py-16 grid lg:grid-cols-2 gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 h-6 px-2.5 bg-sale text-white text-caption uppercase tracking-[0.16em] font-bold mb-4 rounded-full">
              Stay in the game
            </div>
            <h3 className="font-display text-3xl sm:text-4xl leading-[1.05] text-white">
              Drops, deals, and team news.
              <br />
              <span className="font-brush text-gold text-[0.85em] tracking-normal">
                Delivered weekly.
              </span>
            </h3>
          </div>
          <NewsletterForm />
        </div>
      </div>

      {/* Value props strip */}
      <div className="border-b border-white/10">
        <div className="container-wide py-10">
          <ul className="grid grid-cols-2 lg:grid-cols-4 gap-y-6 gap-x-8">
            {VALUE_PROPS.map((p, i) => {
              const tints = [
                'bg-sale/15 text-sale border-sale/30',
                'bg-gold/15 text-gold border-gold/30',
                'bg-accent/15 text-accent-light border-accent/30',
                'bg-white/10 text-white border-white/20',
              ];
              return (
                <li key={p.title} className="flex items-start gap-3">
                  <span className={`shrink-0 size-10 grid place-items-center border rounded-2xl ${tints[i % tints.length]}`}>
                    <p.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <div>
                    <div className="text-body font-semibold text-white">{p.title}</div>
                    <div className="text-caption text-white/60">{p.desc}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Top brands pipe-separated strip */}
      <div className="border-b border-white/10">
        <div className="container-wide py-7">
          <div className="text-caption uppercase tracking-[0.18em] font-bold text-white/60 mb-3">
            Top brands on Sportsmart
          </div>
          <nav
            aria-label="Top brands"
            className="flex flex-wrap items-center gap-y-2 text-body"
          >
            {TOP_BRANDS.map((b, i) => (
              <span key={b.slug} className="inline-flex items-center">
                <Link
                  href={`/products?brand=${b.slug}`}
                  className="text-white/85 hover:text-sale font-medium transition-colors"
                >
                  {b.label}
                </Link>
                {i < TOP_BRANDS.length - 1 && (
                  <span className="mx-3 text-white/25" aria-hidden>|</span>
                )}
              </span>
            ))}
          </nav>
        </div>
      </div>

      {/* Main link grid */}
      <div className="container-wide py-14">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-8 lg:gap-12">
          {/* Brand block */}
          <div className="col-span-2 md:col-span-4 lg:col-span-5">
            <Link href="/" className="font-display text-4xl tracking-wide leading-none italic">
              <span className="text-sale">SPORTSMART</span>
              <span className="text-white">.com</span>
            </Link>
            <p className="mt-4 text-body text-white/75 max-w-sm leading-relaxed">
              India&apos;s sports marketplace. Premium gear from 200+ brands and 500+ sellers, one checkout.
            </p>
            <div className="mt-6 flex gap-2">
              <SocialLink href="https://instagram.com" label="Instagram"><InstagramIcon className="size-4" /></SocialLink>
              <SocialLink href="https://facebook.com" label="Facebook"><FacebookIcon className="size-4" /></SocialLink>
              <SocialLink href="https://twitter.com" label="Twitter / X"><TwitterIcon className="size-3.5" /></SocialLink>
              <SocialLink href="https://youtube.com" label="YouTube"><YoutubeIcon className="size-4" /></SocialLink>
            </div>
          </div>

          <FooterColumn heading="Shop"  links={SHOP_LINKS}  className="md:col-span-3 lg:col-span-2" />
          <FooterColumn heading="Help"  links={HELP_LINKS}  className="md:col-span-3 lg:col-span-2" />
          <FooterColumn heading="About" links={ABOUT_LINKS} className="md:col-span-2 lg:col-span-3" />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="container-wide py-6 flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-8 text-caption text-white/60">
          <div className="text-white/50">
            &copy; {new Date().getFullYear()} Sportsmart. All rights reserved.
          </div>

          <nav className="flex flex-wrap gap-x-5 gap-y-1">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hover:text-white transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="lg:ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-white/50">
              <span className="size-1.5 rounded-full bg-sale" /> India
            </span>
            <span className="text-white/30">·</span>
            <span className="text-white/50 tabular">₹ INR</span>
            <span className="text-white/30">·</span>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_METHODS.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center h-6 px-2 border border-white/10 text-[10px] uppercase tracking-wider text-white/75 rounded-full"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className="size-9 grid place-items-center border border-white/15 text-white hover:border-sale hover:bg-sale hover:text-white transition-colors rounded-full"
    >
      {children}
    </a>
  );
}

function FooterColumn({
  heading,
  links,
  className = '',
}: {
  heading: string;
  links: { label: string; href: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <h4 className="text-caption uppercase tracking-[0.2em] font-semibold text-white mb-4">
        {heading}
      </h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-body text-white/75 hover:text-white transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitted' | 'error'>('idle');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('error');
      return;
    }
    // TODO: wire to a real newsletter endpoint when one exists.
    setStatus('submitted');
    setEmail('');
    setTimeout(() => setStatus('idle'), 4000);
  };

  if (status === 'submitted') {
    return (
      <div className="border border-gold p-5 bg-white/5 rounded-2xl">
        <div className="text-caption uppercase tracking-[0.18em] font-semibold text-gold">
          Subscribed
        </div>
        <p className="mt-2 text-body-lg text-white">
          You&apos;re in. Look for our next drop in your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-white/60 pointer-events-none" />
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === 'error') setStatus('idle');
            }}
            aria-invalid={status === 'error'}
            className={`w-full h-12 pl-11 pr-4 bg-white/5 border text-body-lg text-white placeholder:text-white/40 focus:outline-none transition-colors rounded-full ${
              status === 'error'
                ? 'border-sale focus:border-sale'
                : 'border-white/15 hover:border-white/40 focus:border-gold'
            }`}
          />
        </div>
        <button
          type="submit"
          className="h-12 px-6 bg-sale text-white font-semibold hover:bg-sale-dark inline-flex items-center justify-center gap-2 transition-colors rounded-full"
        >
          Subscribe <ArrowRight className="size-4" />
        </button>
      </div>
      <p className="mt-2 text-caption text-white/60">
        {status === 'error'
          ? 'Please enter a valid email.'
          : 'No spam. Unsubscribe anytime.'}
      </p>
    </form>
  );
}
