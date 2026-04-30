import { Truck, RotateCcw, ShieldCheck } from 'lucide-react';

export function AnnouncementBar() {
  return (
    <div className="bg-navy text-white text-caption">
      <div className="w-full px-4 sm:px-6 lg:px-10 flex items-center justify-center gap-6 py-2 overflow-x-auto whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <Truck className="size-3.5 text-accent-light" strokeWidth={1.75} />
          Free shipping over ₹999
        </span>
        <span className="text-white/30 hidden sm:inline">·</span>
        <span className="inline-flex items-center gap-1.5">
          <RotateCcw className="size-3.5 text-gold" strokeWidth={1.75} />
          7-day easy returns
        </span>
        <span className="text-white/30 hidden sm:inline">·</span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-accent-light" strokeWidth={1.75} />
          100% authentic gear
        </span>
      </div>
    </div>
  );
}
