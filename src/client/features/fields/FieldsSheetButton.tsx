import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { FieldEditor } from "@/client/features/fields/FieldEditor";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { FieldsList } from "@/client/features/fields/FieldsList";
import { SHEET_TITLE } from "@/client/features/fields/fieldsCopy";
import {
  useAppSearch,
  useSetAppSearch,
} from "@/client/features/records/recordStack";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { FIELD_ENTITIES, type FieldEntity } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import { hasOrgPermission } from "@/shared/org-permissions";
import type { RecordKind } from "@/shared/records";
import { fieldEntitySchema } from "@/types/schemas/fields";

// The sheet that manages a kind of record's custom fields (and, from its
// tabs, the other kinds'), over whatever page is current. The URL names it,
// as the CRM's does: `manageFields` the kind of record ("company") and
// `manageField` the field being edited, by key, or "new".

const NEW = "new";

const ENTITY_OF_KIND: Record<RecordKind, FieldEntity> = {
  company: "COMPANY",
  contact: "CONTACT",
  deal: "DEAL",
};

/** Opens the fields sheet on `entity`'s fields. */
export function useOpenFieldsSheet() {
  const setSearch = useSetAppSearch();
  return (entity: FieldEntity) =>
    setSearch({
      manageFields: ENTITY_NOUNS[entity].one,
      manageField: undefined,
    });
}

/** The settings cog of a record sheet's Details, opening the fields sheet. */
export function FieldsSheetButton({ entity }: { entity: FieldEntity }) {
  const openFieldsSheet = useOpenFieldsSheet();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={SHEET_TITLE}
      onClick={() => openFieldsSheet(entity)}
    >
      <Settings />
    </Button>
  );
}

/**
 * The fields sheet, open while the URL names it: from a list's Columns menu
 * ("Edit fields…") or a record's Details. RecordSheetHost renders it.
 */
export function FieldsSheetHost() {
  const { manageFields } = useAppSearch();
  const setSearch = useSetAppSearch();
  // The fields just closed stay while the sheet animates shut.
  const [shown, setShown] = useState(manageFields);
  if (manageFields && manageFields !== shown) setShown(manageFields);

  return (
    <Sheet
      open={manageFields !== undefined}
      onOpenChange={(open) => {
        if (!open)
          setSearch({ manageFields: undefined, manageField: undefined });
      }}
    >
      <SheetContent className="w-full gap-0 outline-none sm:max-w-md">
        {shown ? <FieldsSheetBody entity={ENTITY_OF_KIND[shown]} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function FieldsSheetBody({ entity }: { entity: FieldEntity }) {
  const { manageField: editing } = useAppSearch();
  const setSearch = useSetAppSearch();
  const openFieldsSheet = useOpenFieldsSheet();
  const edit = (key: string | undefined) => setSearch({ manageField: key });
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = hasOrgPermission(workspace?.role ?? "", {
    field: ["manage"],
  });
  const fields = useQuery(fieldsQueryOptions(entity, true));

  const field = fields.data?.find((entry) => entry.key === editing);
  if (canManage && (editing === NEW || field)) {
    return (
      <FieldEditor
        key={editing}
        entity={entity}
        field={field}
        onDone={() => edit(undefined)}
      />
    );
  }

  return (
    <>
      <SheetHeader className="gap-3 border-b">
        <SheetTitle className="pr-8">{SHEET_TITLE}</SheetTitle>
        <Tabs
          value={entity}
          onValueChange={(next) => {
            const parsed = fieldEntitySchema.safeParse(next);
            if (parsed.success) openFieldsSheet(parsed.data);
          }}
        >
          <TabsList>
            {FIELD_ENTITIES.map((option) => (
              <TabsTrigger key={option} value={option}>
                {ENTITY_NOUNS[option].title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </SheetHeader>
      <FieldsList
        entity={entity}
        query={fields}
        canManage={canManage}
        onEdit={edit}
        onNew={() => edit(NEW)}
      />
    </>
  );
}
