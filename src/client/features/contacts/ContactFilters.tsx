import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Briefcase, Building2, Layers, Shapes } from "lucide-react";
import { FilterChip } from "@/client/components/table/FilterChip";
import {
  companyOptionsQueryOptions,
  companyQueryOptions,
} from "@/client/features/companies/companyQueries";
import { contactFilterOptionsQueryOptions } from "@/client/features/contacts/contactQueries";
import type { ContactListSearch } from "@/client/features/contacts/contactSearch";
import {
  ActivityFilter,
  chosen,
  valueOptions,
} from "@/client/features/records/ListFilters";
import { NO_COMPANY } from "@/types/schemas/contacts";
import { FACET_FILTER_MAX } from "@/types/schemas/records";

const SEARCH_DELAY_MS = 250;

/**
 * The contacts list's own filters, after the owner: their company (or
 * none), title, seniority, persona, and how recently anything happened.
 */
export function ContactFilters({
  search,
  onSearchChange,
}: {
  search: ContactListSearch;
  onSearchChange: (update: Partial<ContactListSearch>) => void;
}) {
  const options = useQuery(
    contactFilterOptionsQueryOptions(search.archived ?? false),
  );
  return (
    <>
      <CompanyFilter
        value={search.company ?? []}
        onChange={(company) =>
          onSearchChange({ company: chosen(company), page: undefined })
        }
      />
      <FilterChip
        label="Title"
        icon={Briefcase}
        options={valueOptions(options.data?.titles)}
        value={search.title ?? []}
        max={FACET_FILTER_MAX}
        onChange={(title) =>
          onSearchChange({ title: chosen(title), page: undefined })
        }
      />
      <FilterChip
        label="Seniority"
        icon={Layers}
        options={valueOptions(options.data?.seniorities)}
        value={search.seniority ?? []}
        max={FACET_FILTER_MAX}
        onChange={(seniority) =>
          onSearchChange({ seniority: chosen(seniority), page: undefined })
        }
      />
      <FilterChip
        label="Persona"
        icon={Shapes}
        options={valueOptions(options.data?.personas)}
        value={search.persona ?? []}
        max={FACET_FILTER_MAX}
        onChange={(persona) =>
          onSearchChange({ persona: chosen(persona), page: undefined })
        }
      />
      <ActivityFilter
        value={search.activity}
        onChange={(activity) => onSearchChange({ activity, page: undefined })}
      />
    </>
  );
}

/**
 * Contacts at any of the chosen companies, or at none: the companies are
 * searched on the server as you type, the chosen ones named by their own
 * records.
 */
function CompanyFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuery(input.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [input]);
  const found = useQuery(companyOptionsQueryOptions(query));
  const chosenCompanies = useQueries({
    queries: value
      .filter((id) => id !== NO_COMPANY)
      .map((id) => companyQueryOptions(id)),
  });
  const names = new Map<string, string>();
  for (const company of found.data ?? []) names.set(company.id, company.name);
  for (const { data } of chosenCompanies) {
    if (data) names.set(data.id, data.name);
  }
  const options = [
    ...(query && !value.includes(NO_COMPANY)
      ? []
      : [{ value: NO_COMPANY, label: "No company" }]),
    ...value.flatMap((id) => {
      const name = names.get(id);
      return name ? [{ value: id, label: name }] : [];
    }),
    ...(found.data ?? [])
      .filter((company) => !value.includes(company.id))
      .map((company) => ({ value: company.id, label: company.name })),
  ];
  return (
    <FilterChip
      label="Company"
      icon={Building2}
      options={options}
      value={value}
      max={FACET_FILTER_MAX}
      onChange={onChange}
      onSearch={setInput}
      searching={found.isFetching || input.trim() !== query}
      emptyLabel="No company matches."
    />
  );
}
