import { useState } from "react";
import { CompanySheet } from "@/client/features/companies/CompanySheet";
import { ContactSheet } from "@/client/features/contacts/ContactSheet";
import { DealSheet } from "@/client/features/deals/DealSheet";
import { RecordSheet } from "@/client/features/records/RecordSheet";
import {
  recordKey,
  useRecordStack,
} from "@/client/features/records/recordStack";

/**
 * The sheet every record opens in, over whatever page is current: the top
 * of the URL's record stack. Rendered once, by the signed-in layout.
 */
export function RecordSheetHost() {
  const { top, close } = useRecordStack();
  // The record just closed keeps its content while the sheet animates shut.
  const [shown, setShown] = useState(top);
  if (top && (!shown || recordKey(top) !== recordKey(shown))) setShown(top);

  return (
    <RecordSheet open={top !== undefined} onClose={close}>
      {shown?.kind === "company" ? (
        <CompanySheet key={recordKey(shown)} companyId={shown.id} />
      ) : shown?.kind === "contact" ? (
        <ContactSheet key={recordKey(shown)} contactId={shown.id} />
      ) : shown?.kind === "deal" ? (
        <DealSheet key={recordKey(shown)} dealId={shown.id} />
      ) : null}
    </RecordSheet>
  );
}
