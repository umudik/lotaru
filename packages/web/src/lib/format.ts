import type { ExecutionStatus } from '@/types';

export function nullToEmpty(v: string | null): string {
  if (v === null) {
    return '';
  }
  return v;
}

export function tsOrZero(ts: number | null): number {
  if (ts === null) {
    return 0;
  }
  return ts;
}

export function formatTime(ts: number | null): string {
  if (ts === null) {
    return '—';
  }
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

export function formatRelative(ts: number | null): string {
  if (ts === null) {
    return '';
  }
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return 'just now';
  }
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${String(m)}m ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${String(h)}h ago`;
  }
  const days = Math.floor(diff / 86_400_000);
  return `${String(days)}d ago`;
}

export function formatDuration(start: number | null, end: number | null): string {
  if (start === null) {
    return '—';
  }
  let endVal = end;
  if (endVal === null) {
    endVal = Date.now();
  }
  const ms = endVal - start;
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function statusLabel(s: ExecutionStatus): string {
  if (s === 'success') {
    return 'Success';
  }
  if (s === 'failed') {
    return 'Failed';
  }
  if (s === 'running') {
    return 'Running';
  }
  if (s === 'cancelled') {
    return 'Cancelled';
  }
  return 'Pending';
}

export function statusDotClass(s: ExecutionStatus | 'idle'): string {
  if (s === 'running') {
    return 'bg-primary';
  }
  if (s === 'success') {
    return 'bg-success';
  }
  if (s === 'failed') {
    return 'bg-destructive';
  }
  if (s === 'cancelled') {
    return 'bg-warn';
  }
  if (s === 'pending') {
    return 'bg-muted-foreground';
  }
  return 'bg-muted';
}

export function statusBadgeVariant(
  s: ExecutionStatus,
): 'default' | 'success' | 'destructive' | 'warn' | 'secondary' {
  if (s === 'running') {
    return 'default';
  }
  if (s === 'success') {
    return 'success';
  }
  if (s === 'failed') {
    return 'destructive';
  }
  if (s === 'cancelled') {
    return 'warn';
  }
  return 'secondary';
}
