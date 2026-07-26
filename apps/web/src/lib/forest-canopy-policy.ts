export function forestCanopyClassName(compact = false) {
  return ["forest-canopy", compact ? "compact" : null]
    .filter(Boolean)
    .join(" ");
}
