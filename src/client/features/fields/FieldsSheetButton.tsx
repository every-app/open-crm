import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings, Settings2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/client/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { FieldEditor } from "@/client/features/fields/FieldEditor";
import { fieldsQueryOptions } from "@/client/features/fields/fieldQueries";
import { FieldsList } from "@/client/features/fields/FieldsList";
import {
  SHEET_TITLE,
  sheetSubtitle,
} from "@/client/features/fields/fieldsCopy";
import { workspaceQueryOptions } from "@/client/features/workspace/workspaceQueries";
import { FIELD_ENTITIES, type FieldEntity } from "@/shared/crm-enums";
import { ENTITY_NOUNS } from "@/shared/fields";
import { hasOrgPermission } from "@/shared/org-permissions";
import { fieldEntitySchema } from "@/types/schemas/fields";

const NEW = "new";

/**
 * Opens the sheet that manages an entity's custom fields (and, from its
 * tabs, the other entities'): the list toolbar's "Fields" button, or the
 * settings cog of a record sheet's Details.
 */
export function FieldsSheetButton({
  entity,
  cog = false,
}: {
  entity: FieldEntity;
  cog?: boolean;
}) {
  return (
    <Sheet>
      {cog ? (
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={SHEET_TITLE}
              title={SHEET_TITLE}
            />
          }
        >
          <Settings />
        </SheetTrigger>
      ) : (
        <SheetTrigger render={<Button variant="outline" size="sm" />}>
          <Settings2 data-icon="inline-start" />
          {SHEET_TITLE}
        </SheetTrigger>
      )}
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <FieldsSheet initialEntity={entity} />
      </SheetContent>
    </Sheet>
  );
}

function FieldsSheet({ initialEntity }: { initialEntity: FieldEntity }) {
  const [entity, setEntity] = useState(initialEntity);
  // The field being edited: its id, NEW, or null for the list.
  const [editing, setEditing] = useState<string | null>(null);
  const { data: workspace } = useQuery(workspaceQueryOptions());
  const canManage = hasOrgPermission(workspace?.role ?? "", {
    field: ["manage"],
  });
  const fields = useQuery(fieldsQueryOptions(entity, true));

  const field = fields.data?.find((entry) => entry.id === editing);
  if (canManage && (editing === NEW || field)) {
    return (
      <FieldEditor
        key={editing}
        entity={entity}
        field={field}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <SheetHeader className="gap-3 border-b">
        <div className="space-y-0.5 pr-8">
          <SheetTitle>{SHEET_TITLE}</SheetTitle>
          <SheetDescription>{sheetSubtitle(entity)}</SheetDescription>
        </div>
        <Tabs
          value={entity}
          onValueChange={(next) => {
            const parsed = fieldEntitySchema.safeParse(next);
            if (parsed.success) setEntity(parsed.data);
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
        onEdit={setEditing}
        onNew={() => setEditing(NEW)}
      />
    </>
  );
}
