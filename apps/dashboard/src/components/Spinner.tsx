/**
 * Shared inline spinner. 14px by default, inherits `currentColor` so it sits
 * inside buttons (white on primary, brand on secondary) with no per-call colour.
 * Reused wherever a control previously only swapped its text label
 * ("Sending…", "Reading…", "Generating…"). Respects prefers-reduced-motion via
 * the `motion-reduce:animate-none` utility.
 */
export function Spinner({
  size = 14,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      className={`animate-spin motion-reduce:animate-none ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z"
      />
    </svg>
  );
}
