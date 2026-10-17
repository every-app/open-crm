import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { useDebouncedDraft } from "@/client/hooks/useDebouncedDraft";
import { ROLE_LABELS } from "@/client/features/members/memberRoles";
import { MEMBER_ROLES, type MemberRole } from "@/types/schemas/members";

/** Settings → Members' search, by name or email. */
export function MemberSearch({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  // Typing stays local and reaches the URL after a pause.
  const [draft, setDraft] = useDebouncedDraft(value, onCommit, (text) =>
    text.trim(),
  );
  return (
    <InputGroup className="w-full sm:w-72">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label="Search by name or email"
        placeholder="Search by name or email…"
        value={draft}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
      />
    </InputGroup>
  );
}

/** The Role filter, as the lists' Owner filter: roles with their counts. */
export function RoleFilter({
  value,
  counts,
  onChange,
}: {
  value: MemberRole[];
  counts: Record<MemberRole, number>;
  onChange: (roles: MemberRole[]) => void;
}) {
  const options = MEMBER_ROLES.filter(
    (role) => counts[role] > 0 || value.includes(role),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Filter by role" />
        }
      >
        <ShieldCheck data-icon="inline-start" />
        {value.length === 1 && value[0]
          ? ROLE_LABELS[value[0]]
          : value.length > 1
            ? `${value.length} roles`
            : "Role"}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Role</DropdownMenuLabel>
          {options.map((role) => (
            <DropdownMenuCheckboxItem
              key={role}
              checked={value.includes(role)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, role]
                    : value.filter((chosen) => chosen !== role),
                )
              }
            >
              <span className="flex-1">{ROLE_LABELS[role]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {counts[role]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {value.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange([])}>
              Any role
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
