import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { buttonVariants } from "@/client/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/client/components/ui/combobox";
import { Spinner } from "@/client/components/ui/spinner";
import { companyOptionsQueryOptions } from "@/client/features/companies/companyQueries";
import {
  PROPERTY_CONTROL,
  PropertyRow,
} from "@/client/features/records/InlineField";
import { EntityLogo } from "@/client/features/records/cells";

export type CompanyOption = {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
};

const SEARCH_DELAY_MS = 250;

/** The live companies matching what's typed: the server searches as you type. */
function useCompanySearch() {
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
  return { query, options, setInput };
}

function CompanyItem({ company }: { company: CompanyOption }) {
  return (
    <ComboboxItem value={company}>
      <EntityLogo src={company.iconUrl} name={company.name} size="sm" />
      <span className="truncate">{company.name}</span>
      {company.domain ? (
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {company.domain}
        </span>
      ) : null}
    </ComboboxItem>
  );
}

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
  const { options, setInput } = useCompanySearch();

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
            <CompanyItem key={company.id} company={company} />
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** The list's first item when a record may have no company: picking it clears the company. */
const NO_COMPANY: CompanyOption = {
  id: "",
  name: "No company",
  domain: null,
  iconUrl: null,
};

/**
 * A record sheet's company, changed in place: a plain row like Owner, whose
 * menu searches the companies. `clearable` offers "No company" first, for a
 * record that may have none.
 */
export function InlineCompanyField({
  company,
  saving,
  clearable = false,
  onSave,
  suggestion,
}: {
  company: CompanyOption | null;
  saving: boolean;
  clearable?: boolean;
  onSave: (companyId: string | null) => void;
  /** Under the row: the employer the agent suggests. */
  suggestion?: ReactNode;
}) {
  const id = useId();
  const { query, options, setInput } = useCompanySearch();
  // While saving, the pick shows until the record comes back with it.
  const [picked, setPicked] = useState<CompanyOption | null>(null);
  const items = [
    ...(clearable && !query ? [NO_COMPANY] : []),
    ...(options.data ?? []),
  ];

  return (
    <PropertyRow label="Company" htmlFor={id} suggestion={suggestion}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Combobox
          items={items}
          value={saving ? picked : company}
          onValueChange={(next) => {
            const nextId = next?.id || null;
            if (nextId === (company?.id ?? null)) return;
            setPicked(nextId ? next : null);
            onSave(nextId);
          }}
          onInputValueChange={setInput}
          itemToStringLabel={(option) => option.name}
          isItemEqualToValue={(a, b) => a.id === b.id}
          // The server already matched the search.
          filter={null}
          disabled={saving}
        >
          <ComboboxTrigger
            id={id}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              PROPERTY_CONTROL,
              "min-w-0 flex-1 justify-between data-placeholder:text-muted-foreground",
            )}
          >
            <span className="truncate">
              <ComboboxValue placeholder={NO_COMPANY.name} />
            </span>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              showTrigger={false}
              placeholder="Search companies…"
              aria-label="Search companies"
            />
            <ComboboxEmpty>
              {options.isFetching ? "Searching…" : "No company matches."}
            </ComboboxEmpty>
            <ComboboxList>
              {(option: CompanyOption) =>
                option.id ? (
                  <CompanyItem key={option.id} company={option} />
                ) : (
                  <ComboboxItem key="none" value={option}>
                    {option.name}
                  </ComboboxItem>
                )
              }
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {saving ? <Spinner className="size-3.5" /> : null}
      </div>
    </PropertyRow>
  );
}
