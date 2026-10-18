import { useEffect, useState, type RefObject } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";

/** Within this many pixels of the end, the latest message is in view. */
const NEAR_END_PX = 64;

/**
 * Takes a chat scrolled up back to its latest message (the CRM's
 * MessageScrollerButton), shown while that message is out of view. Sits at
 * the bottom of the scroll area, which the caller positions.
 */
export function ScrollToLatest({
  scrollRef,
  onClick,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  onClick: () => void;
}) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () =>
      setAway(
        element.scrollHeight - element.scrollTop - element.clientHeight >
          NEAR_END_PX,
      );
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    // New messages grow the content without a scroll event.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.lastElementChild) observer.observe(element.lastElementChild);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scrollRef]);

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label="Scroll to end"
      inert={!away}
      onClick={onClick}
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-xs transition-[opacity,translate,scale] duration-200",
        away
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-2 scale-95 opacity-0",
      )}
    >
      <ArrowDown />
    </Button>
  );
}
