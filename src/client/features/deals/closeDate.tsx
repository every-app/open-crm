import { LocalDay } from "@/client/features/records/LocalDateTime";

/**
 * Whether a close date has passed, as the Deals filter counts it: a close
 * date is a day, and it has passed once that day is over (UTC).
 */
function hasPassed(date: string): boolean {
  return date.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

/**
 * A deal's close date, red once it has passed on a deal still open.
 * `spelled` says "overdue" beside it, where there is room: a table cell
 * keeps the word to its title.
 */
export function CloseDate({
  date,
  open,
  spelled = false,
}: {
  date: string;
  open: boolean;
  spelled?: boolean;
}) {
  if (!open || !hasPassed(date)) return <LocalDay date={date} />;
  return (
    <span className="text-destructive" title={spelled ? undefined : "Overdue"}>
      <LocalDay date={date} />
      <span className={spelled ? undefined : "sr-only"}> · overdue</span>
    </span>
  );
}

/**
 * When an open deal listed on a company or a contact should close: "Closes
 * Mar 3, 2027", or that the day has passed. A closed deal has no such line:
 * its stage says how it ended.
 */
export function Closes({ date }: { date: string }) {
  return hasPassed(date) ? (
    <span className="text-destructive">
      Overdue since <LocalDay date={date} />
    </span>
  ) : (
    <>
      Closes <LocalDay date={date} />
    </>
  );
}
