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
    <section className="container-x py-16 sm:py-20">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
        {PROPS.map((p) => (
          <div key={p.title} className="flex items-start gap-4">
            <div className="shrink-0 size-12 grid place-items-center border border-ink-300 rounded-2xl">
              <p.icon className="size-5 text-ink-900" strokeWidth={1.75} />
            </div>
            <div>
              <h4 className="font-semibold text-body-lg text-ink-900">{p.title}</h4>
              <p className="mt-1 text-body text-ink-600 leading-relaxed">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
