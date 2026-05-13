import { Truck, RotateCcw, ShieldCheck, MessageCircle } from 'lucide-react';

const PROPS = [
  {
    icon: Truck,
    title: 'Free shipping over ₹999',
    desc: 'Pan-India delivery in 2–5 business days.',
  },
  {
    icon: RotateCcw,
    title: '7-day easy returns',
    desc: 'Doorstep pickup, no questions asked.',
  },
  {
    icon: ShieldCheck,
    title: '100% authentic',
    desc: 'Sourced direct from brands and trusted sellers.',
  },
  {
    icon: MessageCircle,
    title: '24/7 support',
    desc: 'Real humans, ready when you are.',
  },
];

export function ValueProps() {
  return (
    <section className="container-x py-12 sm:py-16">
      <div className="rounded-3xl bg-gradient-to-br from-ink-50 via-white to-ink-50 border border-ink-200 p-6 sm:p-10 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {PROPS.map((p) => (
            <div
              key={p.title}
              className="flex items-start gap-4 sm:border-r sm:last:border-r-0 sm:border-ink-200 sm:pr-6 last:pr-0"
            >
              <div className="shrink-0 size-12 grid place-items-center bg-white border border-ink-200 rounded-2xl shadow-sm">
                <p.icon className="size-5 text-ink-900" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h4 className="font-semibold text-body-lg text-ink-900 leading-snug">
                  {p.title}
                </h4>
                <p className="mt-1 text-body text-ink-600 leading-relaxed">
                  {p.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
