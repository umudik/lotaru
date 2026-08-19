export function FookieCloudMark(props: {
  href?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  let href = "/projects";
  if (typeof props.href === "string" && props.href.length > 0) {
    href = props.href;
  }
  let size = "md";
  if (props.size === "sm") {
    size = "sm";
  }
  let sizeClass = "";
  if (size === "sm") {
    sizeClass = "fookie-cloud-mark--sm";
  }
  const classes = ["fookie-cloud-mark", sizeClass, props.className]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");
  return (
    <a href={href} className={classes}>
      Lotaru
    </a>
  );
}
