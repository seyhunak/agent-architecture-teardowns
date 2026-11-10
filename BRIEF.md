# Brief: agent-architecture teardown posts

Shared brief for the "I re-engineered …" series in `content/blog/`. Each post takes one well-known industry bottleneck, diagrams the manual process beside a multi-agent workflow, and shows the exact architecture and API costs.

## Files you write (and nothing else)

1. `content/blog/<slug>.md`: the post.
2. `content/blog/diagrams/<slug>.json`: the before/after diagram spec. Copy the shape of `scripts/diagram-spec.example.json`:
   - `before.steps[]` has `{ actor, task, minutes }`.
   - `after.steps[]` has `{ agent, kind: "agent" | "human" | "system", model?, task }`.
   - `title` and `label` are lowercase.
   - Each side has 5–9 steps.
   - Keep `task` under about 110 characters (it wraps to two lines of 62).
   - `model` is a short name such as "Sonnet 5.5" or "Haiku 5.5".
   - `kind: "system"` is deterministic code (OCR, rules, API calls). `kind: "human"` is a person's checkpoint.
3. Then run `node scripts/render-diagrams.mjs` from the repo root. It writes `public/blog/diagrams/<slug>.svg` and fails loudly if the spec is wrong.

Don't touch any other file.

## Front matter

```yaml
---
title: "I re-engineered <process> using an autonomous agent workflow. Here is the exact architecture and the API costs."
date: 2026-11-10
summary: <one or two plain sentences, under 200 characters, with the headline number>
tags: [agent-architecture, <industry>, <process>, api-costs]
---
```

## Honesty rule (non-negotiable)

These are reference architectures on a representative workload, not a named client's results.

- Right under the intro, write one plain sentence saying so, for example: "The firm here is a composite: the volumes are typical for the segment, and every cost below is computed from Claude API list prices on 10 November 2026."
- Never invent client names, quotes, or "we saved X" claims as fact. Use "modelled" and "expected".
- Labour rates and volumes are stated assumptions, with the region named.

## Structure (use these `##` headings, lowercase)

The post is about 1,800–2,600 words of markdown. No raw HTML: it gets stripped. GFM tables are fine.

1. Intro: 2–3 short paragraphs. Name the bottleneck, who suffers it, and the volume assumption (for example, 120 leases a month).
2. The honesty sentence.
3. `## the process today`
   - The diagram, as `![<descriptive alt text naming both sides>](/blog/diagrams/<slug>.svg)`.
   - A table of the manual steps with columns `step | who | minutes`.
   - One paragraph on where the time and the errors actually come from.
4. `## the agent architecture`
   - One subsection (`###`) per agent. For each: its job, the model and why that tier, its inputs, outputs and tools (which systems or APIs it calls), and its guardrails.
   - Say which steps are deterministic code and not an LLM.
   - The orchestration pattern: a pipeline, an orchestrator with workers, or a router. Say why.
   - Where the human checkpoints sit and what triggers escalation (confidence thresholds, value limits, policy rules).
5. `## the exact flow`: a numbered list, end to end, including retries and failure handling.
6. `## the api costs`
   - A table per unit of work (one lease, one claim, …) with columns `agent | model | input tokens | cached input tokens | output tokens | cost per unit`. Then the monthly total at the stated volume.
   - Show the arithmetic once in prose for one row.
   - Apply prompt caching where a stable system prompt or policy document repeats. Cache reads are billed at the cache-read rate; amortise the cache writes.
   - Apply the Batch API (50% off every token class) only to steps that can wait hours, and say which ones.
   - Then a short table: monthly API cost, other running costs (OCR, hosting, storage, observability, as labelled estimates), modelled hours saved, and labour value at the stated rate.
   - Compute every number with `node -e` before writing it, and make sure totals add up.
7. `## what it will get wrong`: concrete failure modes and how each is caught.
8. `## how you know it works`: an evaluation plan with a golden set, its size, the metrics (field-level accuracy, escalation rate, cycle time), and the acceptance bar before go-live.
9. `## the build plan`: a week-by-week plan, 6–10 weeks, for pilot to production.
10. `## run your own numbers`: link the free tools.
    - Link `/tools/ai-token-cost-estimator` with query params that pre-fill this post's workload: `?model=<model id>&requests=<API calls per month>&input=<avg input tokens>&output=<avg output tokens>&cached=<% of input cached>&batch=<% of calls batched>`.
    - Link one other relevant tool: `/tools/agent-workflow-fit-scorer`, `/tools/ai-build-vs-buy-calculator`, `/tools/ai-accuracy-proof-calculator`, or `/tools/eu-ai-act-compliance-auditor`.
    - Close with one line pointing to `/contact`.

## Prices (USD per million tokens, Claude API list, checked 2026-11-10)

| model | id | input | 5-min cache write | cache read | output |
|---|---|---|---|---|---|
| Claude Opus 5.5 | claude-opus-5-5 | 4.00 | 5.00 | 0.20 | 20.00 |
| Claude Sonnet 5.5 | claude-sonnet-5-5 | 2.00 | 2.50 | 0.10 | 10.00 |
| Claude Haiku 5.5 (prompts ≤100K tokens) | claude-haiku-5-5 | 0.10 | 0.125 | 0.01 | 0.50 |
| Claude Haiku 5.5 (prompts >100K tokens) | claude-haiku-5-5 | 0.50 | 0.625 | 0.05 | 2.50 |
| Claude Fable 5.2 | claude-fable-5-2 | 8.00 | 10.00 | 0.20 | 40.00 |

The Batch API takes 50% off every token class. Thinking tokens bill as output; include a realistic allowance for them. Use Opus 5.5 for judgement-heavy steps, Sonnet 5.5 for extraction and drafting, and Haiku 5.5 for classification and routing. Use Fable 5.2 only if a step genuinely needs it.

## Style

- Plain, direct, first person. Short sentences. Sentence case in body copy, lowercase headings.
- No hype words: revolutionary, game-changer, unlock, seamless, leverage, cutting-edge.
- No emoji. No em-dash chains.
- Name real, widely used systems generically or by category (for example "the property management system (Yardi, MRI or AppFolio)"). Don't claim integrations that don't exist.
- Regulatory mentions must be accurate and hedged. Name the regulation (for example HIPAA, GDPR, the EU AI Act, or CMS-0057-F for US prior authorization) only where you are confident it applies.
