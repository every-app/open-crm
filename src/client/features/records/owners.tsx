import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
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
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import { InlineSelectField } from "@/client/features/records/InlineField";
import type { Owner } from "@/client/features/records/cells";
import { UNASSIGNED } from "@/types/schemas/records";

// Who owns a record: one of the organization's members, or nobody. The
// members are the people the gateway has let into the CRM so far.

type OwnerOption = { value: string; label: string };

/** "Unassigned" (or `noneLabel`), then each member by name. */
export function useOwnerOptions(noneLabel = "Unassigned"): OwnerOption[] {
  const members = useQuery(membersQueryOptions());
  return [
    { value: UNASSIGNED, label: noneLabel },
    ...(members.data ?? []).map((member) => ({
      value: member.userId,
      label: member.name,
    })),
  ];
}

/** The owner value a form or menu sends: null for nobody. */
export function ownerIdOf(value: string): string | null {
  return value === UNASSIGNED ? null : value;
}

/** A record sheet's owner, changed in place. */
export function OwnerField({
  owner,
  saving,
  onSave,
}: {
  owner: Owner | null;
  saving: boolean;
  onSave: (ownerId: string | null) => void;
}) {
  const options = useOwnerOptions();
  // Someone who left still owns their records until they're reassigned.
  const items =
    owner && !options.some((option) => option.value === owner.id)
      ? [...options, { value: owner.id, label: owner.name }]
      : options;
  return (
    <InlineSelectField
      label="Owner"
      value={owner?.id ?? UNASSIGNED}
      items={items}
      saving={saving}
      onSave={(value) => onSave(ownerIdOf(value))}
    />
  );
}

/** The list toolbar's owner filter: records any of the chosen owners own. */
export function OwnerFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (owners: string[]) => void;
}) {
  const options = useOwnerOptions();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Filter by owner" />
        }
      >
        <UserRound data-icon="inline-start" />
        Owner
        {value.length > 0 ? (
          <Badge size="sm" aria-label={`${value.length} chosen`}>
            {value.length}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Owned by</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={value.includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, option.value]
                    : value.filter((owner) => owner !== option.value),
                )
              }
            >
              <span className="truncate">{option.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {value.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange([])}>
              Any owner
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
