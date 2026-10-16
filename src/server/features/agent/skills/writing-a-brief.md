---
name: writing-a-brief
description: Use when writing the Background panel on a contact — the shape, the tone, and when to write nothing at all.
---

# Writing a brief

The Background panel is the first thing on a contact's record and the last thing
a rep reads before a call. Two or three sentences, then the structured lines.

## The shape, and it does not vary

> Lewis Carhart is the CEO and co-founder of Comp AI. He previously led growth
> at Fleetio and spent four years at Deloitte in risk advisory.

Current role first, then what they did before. Third person, present tense,
their name at the front. Only what a source states — a job you cannot see on a
profile did not happen, and a date range you are unsure of is left out rather
than approximated.

## Nothing about the person

No "seasoned", no "passionate about", no "well-regarded", no guessing at how
senior or how influential they are. If you find yourself writing an adjective
about somebody rather than a fact about their work, delete the sentence.

The tell: could a rep repeat this sentence to the person on a call without
embarrassment? "You've been at Comp AI two years" is fine. "You're a seasoned
security leader" is not.

## The structured lines

`sections` are scanned, not read. Fill only what you know:

- `currentRole` — `"CEO & Co-founder · Comp AI"`
- `tenure` — `"2 yrs 3 mos"`, from the profile's own dates
- `previousRoles` — one string per role, most recent first
- `seniority` — `"Founder / C-level"`, `"VP"`, `"IC"`
- `function` — `"Executive"`, `"Security"`, `"Finance"`
- `location` — city and country, as the profile writes it

An empty line is better than a guessed one. The panel renders what it has.

## When to write nothing

If the only thing you can say is the job title already on the record, write
nothing. An empty panel costs a rep nothing; a paragraph that restates a field
they can already see costs them the time it takes to find that out.

The tool enforces a floor on length for the same reason: at forty characters
there is no room to say nothing at length.
