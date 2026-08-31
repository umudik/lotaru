import { Link } from "react-router-dom";

export function VoiceSettingsLink(): React.JSX.Element {
  return (
    <Link
      to="/settings#voice"
      className="text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      Voice settings
    </Link>
  );
}
