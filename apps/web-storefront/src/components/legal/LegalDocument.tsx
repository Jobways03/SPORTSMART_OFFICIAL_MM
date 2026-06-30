'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale, Mail, ArrowUp } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';

/**
 * Shared layout for written, version-controlled legal/policy pages served at
 * /pages/<slug> (Terms, Privacy, Refund, …). A three-column docs shell inside
 * the site's centered `container-x`: sticky table of contents (left), the
 * document (center), and a help rail (right). Pages supply their own sections
 * as semantic JSX — no DB seed, no dangerouslySetInnerHTML.
 */

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/* ── Content primitives (used by pages to build section bodies) ──────────── */

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[17px] leading-[1.75] text-ink-700">{children}</p>;
}

/** Label-led list (e.g. "Personal Information: Name, email, …"). */
export function Defs({ items }: { items: [string, string][] }) {
  return (
    <ul className="space-y-3.5">
      {items.map(([term, desc]) => (
        <li key={term} className="text-[17px] leading-[1.75] text-ink-700">
          <span className="font-semibold text-ink-900">{term}:</span> {desc}
        </li>
      ))}
    </ul>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5 list-disc pl-5 marker:text-ink-300">
      {items.map((t, i) => (
        <li key={i} className="pl-1 text-[17px] leading-[1.75] text-ink-700">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps; each item is plain text or a [bold-label, description] pair. */
export function Steps({ items }: { items: ([string, string] | string)[] }) {
  return (
    <ol className="space-y-3 list-decimal pl-5 marker:font-semibold marker:text-ink-400">
      {items.map((it, i) => {
        const [label, desc] = Array.isArray(it) ? it : [null, it];
        return (
          <li key={i} className="pl-1.5 text-[17px] leading-[1.75] text-ink-700">
            {label && <span className="font-semibold text-ink-900">{label}: </span>}
            {desc}
          </li>
        );
      })}
    </ol>
  );
}

/** Tinted callout box for grouped detail (e.g. a grievance-officer block). */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5 text-[16px] leading-relaxed text-ink-700 [&>*+*]:mt-2.5 sm:p-6">
      {children}
    </div>
  );
}

/** Sub-heading within a section (e.g. "Additional Packing Guidelines"). */
export function SubHead({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-lg font-semibold text-ink-900">{children}</h3>;
}

/** Bordered two-column reference table (e.g. packing material standards). */
export function Table({ head, rows }: { head?: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-200">
      <table className="w-full border-collapse text-left text-[15px]">
        {head && (
          <thead>
            <tr className="bg-ink-50">
              {head.map((h, i) => (
                <th
                  key={i}
                  className={`px-5 py-3.5 font-semibold text-ink-900 ${
                    i === 0 ? 'border-r border-ink-200' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri > 0 || head ? 'border-t border-ink-200' : ''}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-5 py-4 align-top leading-relaxed text-ink-700 ${
                    ci === 0 ? 'border-r border-ink-200 font-medium text-ink-900' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tinted contact block — typically the last section of a policy. */
export function ContactCallout({ intro, email }: { intro: string; email: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5 sm:p-6">
      <P>{intro}</P>
      <a
        href={`mailto:${email}`}
        className="mt-3 inline-flex items-center gap-2 text-[17px] font-medium text-ink-900 hover:text-accent-dark"
      >
        <Mail className="size-4" aria-hidden />
        {email}
      </a>
    </div>
  );
}

/* ── The page shell ──────────────────────────────────────────────────────── */

export function LegalDocument({
  title,
  lead,
  lastUpdated,
  sections,
  org,
  contactEmail = 'support@sportsmart.com',
}: {
  title: string;
  lead: string;
  lastUpdated: string;
  sections: LegalSection[];
  /** Optional legal-entity name shown before "Last updated". */
  org?: string;
  /** Email surfaced in the right-hand help rail. */
  contactEmail?: string;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    document.title = `${title} | Sportsmart`;
  }, [title]);

  // Scroll-spy: highlight the section currently in view in the table of
  // contents. rootMargin biases toward the section nearest the top.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <StorefrontShell>
      {/* Left-anchored docs layout (aligned to the site's left gutter), with a
          capped reading column so lines stay comfortable on wide screens. */}
      <div className="container-wide py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,720px)] lg:gap-12 xl:grid-cols-[280px_minmax(0,820px)_minmax(0,1fr)] xl:gap-14">
          {/* Left — sticky table of contents */}
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-24">
              <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.2em] text-ink-500">
                On this page
              </p>
              <ul className="border-l border-ink-200">
                {sections.map((s, i) => {
                  const isActive = active === s.id;
                  return (
                    <li key={s.id} className="relative">
                      {/* Inset rounded active indicator that sits on the rail */}
                      <span
                        aria-hidden
                        className={`absolute -left-px top-1.5 bottom-1.5 w-0.5 rounded-full transition-colors ${
                          isActive ? 'bg-ink-900' : 'bg-transparent'
                        }`}
                      />
                      <a
                        href={`#${s.id}`}
                        aria-current={isActive ? 'true' : undefined}
                        className={`group flex gap-3 py-3 pl-4 pr-1 text-[16px] leading-snug transition-[color,transform] duration-150 ease-out hover:translate-x-1 motion-reduce:transition-none motion-reduce:hover:translate-x-0 ${
                          isActive ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900'
                        }`}
                      >
                        <span
                          className={`w-[22px] shrink-0 text-[14px] tabular-nums ${
                            isActive
                              ? 'font-semibold text-ink-900'
                              : 'text-ink-400 group-hover:text-ink-600'
                          }`}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className={isActive ? 'font-semibold' : undefined}>{s.title}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          {/* Center — the document */}
          <main className="min-w-0">
            {/* Breadcrumb */}
            <div className="text-[12px] uppercase tracking-wider text-ink-500">
              <Link href="/" className="hover:text-ink-900">
                Home
              </Link>
              {' / '}
              <span className="text-ink-700">{title}</span>
            </div>

            {/* Header */}
            <header className="mt-5">
              <div className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] font-semibold text-ink-500">
                <Scale className="size-4" aria-hidden />
                Legal
              </div>
              <h1 className="mt-3 font-display text-[2rem] sm:text-[2.5rem] leading-[1.1] tracking-tight text-ink-900">
                {title}
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-ink-600">{lead}</p>
              <p className="mt-3 text-sm text-ink-500">
                {org ? `${org} · ` : ''}Last updated {lastUpdated}
              </p>
            </header>

            {/* Sections */}
            <div className="mt-12 space-y-12">
              {sections.map((s, i) => (
                <section key={s.id} aria-labelledby={s.id}>
                  {/* scroll-mt on the anchored element (the h2 holds the id) so a
                      TOC click lands the heading below the sticky navbar — not at
                      y=0 under it, which used to make scroll-spy pick the next
                      section. */}
                  <h2
                    id={s.id}
                    className="scroll-mt-32 flex items-baseline gap-3 font-display text-2xl tracking-tight text-ink-900"
                  >
                    <span className="text-base font-bold tabular-nums text-ink-400">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>{s.title}</span>
                  </h2>
                  <div className="mt-5 space-y-4">{s.body}</div>
                </section>
              ))}
            </div>
          </main>

          {/* Right — help rail, centered in the space between the content and
              the page's right edge */}
          <aside className="hidden xl:block">
            <div className="sticky top-24 mx-auto w-[300px] space-y-4">
              <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5">
                <div className="text-[12px] uppercase tracking-[0.16em] font-semibold text-ink-500">
                  Need help?
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-700">
                  Questions about this policy? Our support team is happy to help.
                </p>
                <a
                  href={`mailto:${contactEmail}`}
                  className="mt-3 inline-flex items-center gap-2 text-[15px] font-medium text-ink-900 hover:text-accent-dark"
                >
                  <Mail className="size-4" aria-hidden />
                  {contactEmail}
                </a>
              </div>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-1.5 pl-1 text-[13px] text-ink-500 hover:text-ink-900"
              >
                <ArrowUp className="size-3.5" aria-hidden />
                Back to top
              </button>
            </div>
          </aside>
        </div>
      </div>
    </StorefrontShell>
  );
}
