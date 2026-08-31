import { Link } from "react-router-dom";

export function AiSettingsLink(): React.JSX.Element {
  return (
    <Link
      to="/settings#ai"
      className="text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      Agent settings
    </Link>
  );
}
