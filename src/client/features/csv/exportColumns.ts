import type { CompanyRow } from "@/client/features/companies/companyFormat";
import type { ContactRow } from "@/client/features/contacts/contactFormat";
import type { DealRow } from "@/client/features/deals/dealFormat";
import { DEAL_STAGE_LABELS } from "@/shared/deal-stages";
import { csvDay, type ExportColumn } from "./CsvMenu";

// Each list's columns in an export, headed as the import reads them back
// (IMPORT_TARGETS): owners by email, days as 2027-03-31, stages by name.

export const COMPANY_EXPORT: ExportColumn<CompanyRow>[] = [
  ["Name", (row) => row.name],
  ["Domain", (row) => row.domain],
  ["Industry", (row) => row.industry],
  ["City", (row) => row.city],
  ["State", (row) => row.stateCode],
  ["Country", (row) => row.country],
  ["Owner", (row) => row.owner?.email],
  ["Contacts", (row) => row.contactCount],
  ["Open deals", (row) => row.openDealCount],
  ["Last activity", (row) => csvDay(row.lastActivityAt)],
  ["Created", (row) => csvDay(row.createdAt)],
];

export const CONTACT_EXPORT: ExportColumn<ContactRow>[] = [
  ["First name", (row) => row.firstName],
  ["Last name", (row) => row.lastName],
  ["Email", (row) => row.email],
  ["Job title", (row) => row.title],
  ["Company", (row) => row.company?.name],
  ["Company website", (row) => row.company?.domain],
  ["Owner", (row) => row.owner?.email],
  ["Last activity", (row) => csvDay(row.lastActivityAt)],
  ["Created", (row) => csvDay(row.createdAt)],
];

export const DEAL_EXPORT: ExportColumn<DealRow>[] = [
  ["Name", (row) => row.name],
  ["Company", (row) => row.company.name],
  ["Stage", (row) => DEAL_STAGE_LABELS[row.stage]],
  ["Amount", (row) => row.amount],
  ["Currency", (row) => row.currency],
  ["Close date", (row) => csvDay(row.expectedCloseDate)],
  ["Owner", (row) => row.owner.email],
  ["Last activity", (row) => csvDay(row.lastActivityAt)],
  ["Created", (row) => csvDay(row.createdAt)],
];
