"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

type Placement = "top" | "bottom" | "left" | "right";

/**
 * Minimal accessible tooltip (no Radix — the dashboard avoids extra deps).
 *
 * - Triggers on hover AND keyboard focus (so icon-only controls are reachable).
 * - 300ms open delay; hides immediately on blur/leave/Escape.
 * - Links trigger → bubble via aria-describedby (screen-reader announced).
 * - Auto-flips to the opposite side when it would overflow the viewport.
 * - Disabled under prefers-reduced-motion only for the fade, not visibility.
 *
 * Use ONLY on icon-only controls (no visible text label). A visible-text button
 * with a tooltip is redundant noise — don't wrap those.
 */
export function Tooltip({
  content,
  placement = "top",
  delay = 300,
  children,
}: {
  content: ReactNode;
  placement?: Placement;
  delay?: number;
  children: ReactElement;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<Placement>(placement);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clear, delay]);

  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  // Auto-flip if the bubble overflows the viewport edge it points from.
  useEffect(() => {
    if (!open || !bubbleRef.current) return;
    const r = bubbleRef.current.getBoundingClientRect();
    const pad = 8;
    let next = placement;
    if (placement === "top" && r.top < pad) next = "bottom";
    else if (placement === "bottom" && r.bottom > window.innerHeight - pad) next = "top";
    else if (placement === "left" && r.left < pad) next = "right";
    else if (placement === "right" && r.right > window.innerWidth - pad) next = "left";
    if (next !== resolved) setResolved(next);
  }, [open, placement, resolved]);

  useEffect(() => {
    if (open) return;
    setResolved(placement);
  }, [open, placement]);

  if (!isValidElement(children)) return children;

  const childProps = children.props as Record<string, unknown>;
  const describedBy = [childProps["aria-describedby"], open ? id : null]
    .filter(Boolean)
    .join(" ") || undefined;

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-describedby": describedBy,
    onMouseEnter: compose(childProps.onMouseEnter, show),
    onMouseLeave: compose(childProps.onMouseLeave, hide),
    onFocus: compose(childProps.onFocus, show),
    onBlur: compose(childProps.onBlur, hide),
    onKeyDown: compose(childProps.onKeyDown, (e: React.KeyboardEvent) => {
      if (e.key === "Escape") hide();
    }),
  });

  return (
    <span ref={wrapRef} className="relative inline-flex" onMouseLeave={hide}>
      {trigger}
      <span
        ref={bubbleRef}
        role="tooltip"
        id={id}
        hidden={!open}
        className={[
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md",
          "transition-opacity duration-100 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
          POSITION[resolved],
        ].join(" ")}
      >
        {content}
      </span>
    </span>
  );
}

const POSITION: Record<Placement, string> = {
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
  right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
};

function compose(existing: unknown, next: (e: never) => void) {
  return (e: never) => {
    if (typeof existing === "function") (existing as (ev: never) => void)(e);
    next(e);
  };
}
