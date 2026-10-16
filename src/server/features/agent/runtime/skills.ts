import type { SkillSource } from "@cloudflare/think";
import dataBoundaries from "../skills/data-boundaries.md?raw";
import evidence from "../skills/evidence.md?raw";
import identityMatching from "../skills/identity-matching.md?raw";
import writingABrief from "../skills/writing-a-brief.md?raw";

// The agent's four skills, ported from the CRM's skills/*.md, as Think skills:
// the catalog (name and description) is in every system prompt, and the agent
// loads a skill's body with activate_skill when the work calls for it. The
// source implements SkillSource by hand, as OpenSEO's SAM does: the
// agents/skills runtime module would drag the skill-script executor into the
// bundle, which static markdown doesn't need.

type Skill = { name: string; description: string; body: string };

function parseSkill(raw: string): Skill {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("A skill has no frontmatter.");
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1])?.[1]?.trim();
  const name = field("name");
  const description = field("description");
  if (!name || !description) {
    throw new Error("A skill's frontmatter needs a name and a description.");
  }
  return { name, description, body: match[2].trim() };
}

// Content hash so Think refreshes the catalog when a deploy changes a skill.
function fingerprint(skills: Skill[]): string {
  let hash = 5381;
  for (const ch of skills.map((s) => `${s.name}\n${s.body}`).join("\n")) {
    hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

let source: SkillSource | undefined;

export function agentSkillSource(): SkillSource {
  if (source) return source;
  const skills = [
    dataBoundaries,
    evidence,
    identityMatching,
    writingABrief,
  ].map(parseSkill);
  source = {
    id: "crm-agent-skills",
    fingerprint: fingerprint(skills),
    list: () =>
      Promise.resolve(
        skills.map(({ name, description }) => ({ name, description })),
      ),
    load: (name) =>
      Promise.resolve(skills.find((skill) => skill.name === name) ?? null),
  };
  return source;
}
