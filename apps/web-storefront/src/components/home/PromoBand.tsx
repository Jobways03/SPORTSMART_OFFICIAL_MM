import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function PromoBand() {
  return (
    <section className="bg-sale text-white">
      <div className="container-x py-12 sm:py-16">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="text-caption uppercase tracking-[0.2em] text-white/70 font-semibold">
              Limited time
            </div>
            <h3 className="mt-2 font-display text-4xl sm:text-6xl leading-none">
              Up to 60% off this week.
            </h3>
            <p className="mt-3 text-body-lg text-white/85 max-w-xl">
              Footwear, jerseys, and equipment from top brands. Stock is moving fast.
            </p>
          </div>
          <Link
            href="/products?onSale=true"
            className="self-start inline-flex items-center gap-2 h-12 px-6 bg-ink-900 text-white font-semibold hover:bg-black transition-colors"
          >
            Shop the sale
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
