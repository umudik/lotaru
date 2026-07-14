import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { INSTALL_CMD } from '@/lib/config';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
}

export function CopyCommand(props: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background p-1.5 pl-3 font-mono text-sm',
        props.className,
      )}
    >
      <span className="text-muted-foreground select-none">$</span>
      <code className="flex-1 truncate text-foreground">{INSTALL_CMD}</code>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => {
          void copy();
        }}
        aria-label="Copy install command"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
