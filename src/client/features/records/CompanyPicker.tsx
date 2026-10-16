import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/client/components/ui/combobox";
import { companyOptionsQueryOptions } from "@/client/features/companies/companyQueries";
import { EntityLogo } from "@/client/features/records/cells";

export type CompanyOption = {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
};

const SEARCH_DELAY_MS = 250;

/**
 * Picks one of the organization's live companies: type part of its name or
 * domain and the server searches as you type. Clearing the input chooses no
 * company (null).
 */
export function CompanyPicker({
  id,
  value,
  onChange,
  placeholder = "Search companies…",
  disabled = false,
}: {
  id?: string;
  value: CompanyOption | null;
  onChange: (company: CompanyOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
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
  const options = useQuery(companyOptionsQueryOptions(query));

  return (
    <Combobox
      items={options.data ?? []}
      value={value}
      onValueChange={onChange}
      onInputValueChange={setInput}
      itemToStringLabel={(company) => company.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      // The server already matched the search.
      filter={null}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        showClear={value !== null}
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {options.isFetching ? "Searching…" : "No company matches."}
        </ComboboxEmpty>
        <ComboboxList>
          {(company: CompanyOption) => (
            <ComboboxItem key={company.id} value={company}>
              <EntityLogo src={company.iconUrl} name={company.name} size="sm" />
              <span className="truncate">{company.name}</span>
              {company.domain ? (
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {company.domain}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
