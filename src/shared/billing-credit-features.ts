/**
 * What the CRM's spend is for, on each usage event (`properties.creditFeature`)
 * and in the usage breakdown: the agent's model calls (chats, research,
 * team agent runs, their compaction summaries and Sonar web research), and
 * Context.dev's company and people data.
 */
export type CreditFeature = "crm_agent" | "company_data";

// The credits are one balance with OpenSEO's on Every App, so the breakdown
// also shows OpenSEO's usage: its labels are here as OpenSEO names them.
const CREDIT_FEATURE_LABELS: Record<string, string> = {
  crm_agent: "CRM Agent",
  company_data: "Company Data",
  keyword_research: "Keyword Research",
  domain_overview: "Domain Overview",
  backlinks: "Backlinks",
  site_audit: "Site Audit",
  rank_tracking: "Rank Tracking",
  ai_citations: "AI Citations",
  ai_prompt_responses: "AI Prompt Responses",
  ai_search: "AI Search",
  local_seo: "Local SEO",
  onboarding: "Onboarding",
  agent: "SAM Agent",
};

export function creditFeatureLabel(key: string) {
  return CREDIT_FEATURE_LABELS[key] ?? "Other";
}
