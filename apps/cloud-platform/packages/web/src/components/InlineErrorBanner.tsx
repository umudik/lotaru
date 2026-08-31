export function InlineErrorBanner(props: { message: string }): React.JSX.Element | null {
  if (props.message.length === 0) {
    return null;
  }
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {props.message}
    </p>
  );
}
