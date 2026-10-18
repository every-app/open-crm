import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { FilterChip } from "@/client/components/table/FilterChip";
import { membersQueryOptions } from "@/client/features/members/memberQueries";
import { InlineSelectField } from "@/client/features/records/InlineField";
import type { Owner } from "@/client/features/records/cells";
import { OWNER_FILTER_MAX, UNASSIGNED } from "@/types/schemas/records";

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
  counts,
}: {
  value: string[];
  onChange: (owners: string[]) => void;
  counts: Record<string, number> | undefined;
}) {
  return (
    <FilterChip
      label="Owner"
      icon={UserRound}
      options={useOwnerOptions()}
      value={value}
      onChange={onChange}
      counts={counts}
      max={OWNER_FILTER_MAX}
    />
  );
}
