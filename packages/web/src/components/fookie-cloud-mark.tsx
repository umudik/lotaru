const FOOKIE_CLOUD = 'https://fookiecloud.com';

export function FookieCloudMark(props: {
  href?: string;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  const href = props.href ?? FOOKIE_CLOUD;
  const size = props.size ?? 'sm';
  const text = size === 'md' ? 'text-[1.05rem]' : 'text-[0.95rem]';
  return (
    <a
      href={href}
      className={
        props.className ??
        `inline-flex items-baseline gap-0 ${text} font-bold tracking-[-0.02em] hover:opacity-90 transition-opacity`
      }
    >
      <span className="text-foreground">Fookie</span>
      <span className="fookie-cloud-word">Cloud</span>
    </a>
  );
}

export { FOOKIE_CLOUD };
