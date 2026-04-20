interface ComingSoonProps {
  title: string;
  icon?: string;
  description?: string;
}

export default function ComingSoon({
  title,
  icon = '&#128736;',
  description = 'This feature is being built.',
}: ComingSoonProps) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="coming-soon">
        <div
          className="coming-soon-icon"
          dangerouslySetInnerHTML={{ __html: icon }}
        />
        <h2>Coming soon</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}
