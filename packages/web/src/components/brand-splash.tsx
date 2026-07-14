import { FookieCloudMark } from '@/components/fookie-cloud-mark';

export function BrandSplash(props: {
  title: string;
  subtitle?: string;
}): React.JSX.Element {
  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <FookieCloudMark size="md" />
        <div className="space-y-1.5">
          <div className="text-lg font-semibold tracking-tight">{props.title}</div>
          {props.subtitle !== undefined ? (
            <p className="text-xs text-muted-foreground">{props.subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
