import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

export function SettingsDisclosure({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const hash = useLocation({ select: (location) => location.hash });
  return (
    <details
      id={id}
      open={hash === id || undefined}
      className="group scroll-mt-6 border-t border-border pt-5"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="space-y-6 pt-5">{children}</div>
    </details>
  );
}
