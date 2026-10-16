import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { groupBy } from "remeda";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/client/components/ui/combobox";
import {
  agentModelQueryOptions,
  modelCatalogQueryOptions,
  useCanManageWorkspace,
} from "@/client/features/settings/settingsQueries";
import type { CatalogModel } from "@/server/features/settings/services/ModelCatalogService";
import type { AgentModelSetting } from "@/server/features/settings/services/SettingsService";
import { setAgentModel } from "@/serverFunctions/settings";

/** One entry of the picker: a catalog model, or following the default. */
type ModelChoice = {
  key: string;
  /** Null follows the default model. */
  modelId: string | null;
  label: string;
  hint: string | null;
  search: string;
};

type ChoiceGroup = { value: string; items: ModelChoice[] };

function perMillion(perToken: number): string {
  return `$${(perToken * 1_000_000).toFixed(2).replace(/\.?0+$/, "")}`;
}

function contextHint(tokens: number): string {
  return tokens >= 1_000_000
    ? `${Math.round(tokens / 1_000_000)}M context`
    : `${Math.round(tokens / 1_000)}K context`;
}

function priceHint(model: CatalogModel): string | null {
  if (!model.pricing) return null;
  return `${perMillion(model.pricing.input)} in · ${perMillion(model.pricing.output)} out per 1M`;
}

function toChoice(model: CatalogModel): ModelChoice {
  return {
    key: model.id,
    modelId: model.id,
    label: model.name,
    hint: priceHint(model) ?? contextHint(model.contextWindowTokens),
    search: `${model.name} ${model.id}`.toLowerCase(),
  };
}

const matches = (choice: ModelChoice, query: string) =>
  choice.search.includes(query.trim().toLowerCase());

/**
 * Settings → Agent: the model the research agent thinks with, from
 * OpenRouter's tool-using models. Owners and admins pick it; the agent uses
 * it from its next session.
 */
export function AgentModelPicker() {
  const canManage = useCanManageWorkspace();
  const settingQuery = useQuery(agentModelQueryOptions());
  const catalogQuery = useQuery(modelCatalogQueryOptions());

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Model"
        hint={
          canManage
            ? undefined
            : "Only an owner or an admin can change the agent's model."
        }
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        The model the research agent thinks with, through OpenRouter on your
        Every App gateway.
      </p>
      <QueryState
        query={settingQuery}
        errorFallback="The agent's model could not be loaded."
      >
        {(setting) => {
          const models = catalogQuery.data?.models ?? [];
          const effective = models.find((model) => model.id === setting.id);
          return (
            <div className="max-w-xl space-y-2">
              {canManage ? (
                <ModelCombobox
                  setting={setting}
                  models={models}
                  disabled={
                    catalogQuery.isPending ||
                    catalogQuery.data?.available === false
                  }
                />
              ) : (
                <p className="text-sm font-medium">
                  {effective?.name ?? setting.id}
                  {setting.isDefault ? " (default)" : null}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {catalogQuery.data?.available === false
                  ? `Could not reach OpenRouter to list models. The agent is still running ${setting.id}.`
                  : [
                      setting.id,
                      contextHint(
                        effective?.contextWindowTokens ??
                          setting.contextWindowTokens,
                      ),
                      effective ? priceHint(effective) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function ModelCombobox({
  setting,
  models,
  disabled,
}: {
  setting: AgentModelSetting;
  models: CatalogModel[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (modelId: string | null) =>
      setAgentModel({ data: { modelId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: agentModelQueryOptions().queryKey,
      });
      toast.success("The agent will use this model from its next session.");
    },
  });

  const defaultModel = models.find((model) => model.id === setting.defaultId);
  const defaultChoice: ModelChoice = {
    key: "default",
    modelId: null,
    label: `Default — ${defaultModel?.name ?? setting.defaultId}`,
    hint: defaultModel ? toChoice(defaultModel).hint : null,
    search:
      `default ${defaultModel?.name ?? ""} ${setting.defaultId}`.toLowerCase(),
  };
  const groups: ChoiceGroup[] = [
    { value: "Default", items: [defaultChoice] },
    ...Object.entries(groupBy(models, (model) => model.provider)).map(
      ([provider, group]) => ({ value: provider, items: group.map(toChoice) }),
    ),
  ];
  const picked = models.find((model) => model.id === setting.id);
  // A pick the catalog no longer lists still shows as itself.
  const selected: ModelChoice = setting.isDefault
    ? defaultChoice
    : picked
      ? toChoice(picked)
      : {
          ...defaultChoice,
          key: setting.id,
          modelId: setting.id,
          label: setting.id,
        };

  return (
    <Combobox
      items={groups}
      value={selected}
      itemToStringLabel={(choice: ModelChoice) => choice.label}
      isItemEqualToValue={(choice, value) => choice.key === value.key}
      filter={matches}
      autoHighlight
      disabled={disabled || save.isPending}
      onValueChange={(choice) => {
        if (choice && choice.key !== selected.key) save.mutate(choice.modelId);
      }}
    >
      <ComboboxInput
        className="w-full"
        placeholder="Search models"
        aria-label="Model"
      />
      <ComboboxContent>
        <ComboboxEmpty>No model matches that.</ComboboxEmpty>
        <ComboboxList>
          {(group: ChoiceGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(choice: ModelChoice) => (
                  <ComboboxItem key={choice.key} value={choice}>
                    <span className="min-w-0 truncate">{choice.label}</span>
                    {choice.hint ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {choice.hint}
                      </span>
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
