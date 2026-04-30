type Size = 'sm' | 'md' | 'lg';

const currentSize: Record<Size, string> = {
  sm: 'text-body-lg',
  md: 'text-h3',
  lg: 'text-h2',
};

const compareSize: Record<Size, string> = {
  sm: 'text-caption',
  md: 'text-body',
  lg: 'text-body-lg',
};

const formatINR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function PriceTag({
  price,
  compareAt,
  size = 'md',
}: {
  price: number | null | undefined;
  compareAt?: number | null;
  size?: Size;
}) {
  if (price == null) return <span className="text-ink-500">--</span>;

  const showCompare = compareAt != null && Number(compareAt) > Number(price);
  const discount = showCompare
    ? Math.round(((Number(compareAt) - Number(price)) / Number(compareAt)) * 100)
    : null;

  return (
    <div className="flex items-baseline gap-2 tabular">
      <span className={`font-semibold text-ink-900 ${currentSize[size]}`}>
        {formatINR(Number(price))}
      </span>
      {showCompare && (
        <>
          <span className={`text-ink-500 line-through ${compareSize[size]}`}>
            {formatINR(Number(compareAt))}
          </span>
          {discount && (
            <span className={`font-semibold text-sale ${compareSize[size]}`}>
              {discount}% off
            </span>
          )}
        </>
      )}
    </div>
  );
}
