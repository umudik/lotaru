import { ArrowLeft } from 'lucide-react';
import { isCloudHost } from '@/lib/auth';

const FOOKIE_CLOUD = 'https://fookiecloud.com';

export function FookieCloudBack(props: { className?: string }): React.JSX.Element | null {
  if (!isCloudHost()) {
    return null;
  }
  return (
    <a
      href={FOOKIE_CLOUD}
      className={
        props.className ??
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors'
      }
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Fookie Cloud
    </a>
  );
}
