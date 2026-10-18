import { useState } from "react";
import { CompanySheet } from "@/client/features/companies/CompanySheet";
import { ContactSheet } from "@/client/features/contacts/ContactSheet";
import { CloseReasonHost } from "@/client/features/deals/DealStage";
import { DealSheet } from "@/client/features/deals/DealSheet";
import { FieldsSheetHost } from "@/client/features/fields/FieldsSheetButton";
import { RecordSheet } from "@/client/features/records/RecordSheet";
import {
  recordKey,
  useRecordStack,
} from "@/client/features/records/recordStack";
import { QuickSwitcherDialog } from "@/client/features/search/QuickSwitcher";

/**
 * The sheet every record opens in, over whatever page is current: the top
 * of the URL's record stack. Rendered once, by the signed-in layout, with
 * the dialogs the URL opens over the page.
 */
export function RecordSheetHost() {
  const { top, close } = useRecordStack();
  // The record just closed keeps its content while the sheet animates shut.
  const [shown, setShown] = useState(top);
  if (top && (!shown || recordKey(top) !== recordKey(shown))) setShown(top);

  return (
    <>
      <RecordSheet open={top !== undefined} onClose={close}>
        {shown?.kind === "company" ? (
          <CompanySheet key={recordKey(shown)} companyId={shown.id} />
        ) : shown?.kind === "contact" ? (
          <ContactSheet key={recordKey(shown)} contactId={shown.id} />
        ) : shown?.kind === "deal" ? (
          <DealSheet key={recordKey(shown)} dealId={shown.id} />
        ) : null}
        {top ? <UrlDialogs /> : null}
      </RecordSheet>
      {top ? null : <UrlDialogs />}
    </>
  );
}

/**
 * The dialogs the URL opens over the page: the fields sheet, the reason a
 * deal closing as lost asks for, and the quick switcher. With a record open
 * they open inside its sheet: two dialogs opened side by side, as when a
 * link names both, would each keep the other from the keyboard.
 */
function UrlDialogs() {
  return (
    <>
      <FieldsSheetHost />
      <CloseReasonHost />
      <QuickSwitcherDialog />
    </>
  );
}
