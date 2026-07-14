import { FookieCloudMark } from '@/components/fookie-cloud-mark';

export function BrandSplash(props: {
  title: string;
  subtitle?: string;
}): React.JSX.Element {
  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-11 h-11 rounded-xl bg-primary grid place-items-center text-primary-foreground font-bold text-lg animate-pulse">
          {props.title.charAt(0)}
        </div>
        <div className="space-y-1.5">
          <div className="text-lg font-semibold tracking-tight">{props.title}</div>
          <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <span>by</span>
            <FookieCloudMark size="md" className="inline-flex items-baseline gap-0 text-sm font-semibold tracking-tight" />
          </div>
          {props.subtitle !== undefined ? (
            <p className="pt-2 text-xs text-muted-foreground">{props.subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
