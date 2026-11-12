# Agent architecture teardowns

Nine common industry bottlenecks, each re-engineered as a multi-agent AI workflow. Every post diagrams the manual process beside the agent architecture, then shows the exact agents, models, human checkpoints, failure modes, evaluation plan and **API costs worked out from Claude list prices**.

| process | summary |
|---|---|
| [AML alert triage](posts/aml-alert-triage-agent-workflow.md) | A six-agent workflow that prepares AML alerts for analyst decision at about 6.5 cents of API cost each, cutting staff time from 60 to a modelled 17 minutes. |
| [Chargeback disputes](posts/chargeback-dispute-agent-workflow.md) | Handling 4,000 chargebacks a month with deterministic evidence code and four Claude agents costs about $176 a month in API fees, modelled to save around 1,400 analyst hours. |
| [Freight invoice audit](posts/freight-invoice-audit-agent-workflow.md) | Auditing 25,000 carrier invoices a month with deterministic rating code and four Claude agents costs about $292 a month in API fees, modelled to save around 3,000 staff hours. |
| [Claims intake (FNOL)](posts/insurance-claims-intake-agent-workflow.md) | A five-agent FNOL intake workflow for 9,000 motor and home claims a month, modelled at about $0.28 of API cost per claim and $2,517 a month. |
| [LC document checking](posts/lc-document-examination-agent-workflow.md) | Five Claude agents prepare letter of credit presentations for a checker's decision at about 31 cents of API cost each, cutting modelled staff time from 95 to 25 minutes. |
| [Lease abstraction](posts/lease-abstraction-agent-workflow.md) | A four-agent lease abstraction workflow for 120 leases a month costs about $81 a month in API calls and is modelled to save 380 staff hours. |
| [Prior authorization](posts/prior-authorization-agent-workflow.md) | A multi-agent prior-authorization workflow for a specialty practice doing 3,000 requests a month. About $330 a month in API costs and a modelled 1,900 staff hours saved. |
| [Security questionnaires](posts/security-questionnaire-agent-workflow.md) | Drafting 80 security questionnaires a month from an approved answer library with four Claude agents costs about $118 a month in API fees, modelled to save 600 hours. |
| [SME credit memos](posts/sme-credit-memo-agent-workflow.md) | A six-agent workflow that prepares SME credit memos for committee at about $1.20 in API cost per application, cutting staff time from 13.5 hours to a modelled 2.5. |

![Lease abstraction: manual process beside the agent workflow](diagrams/lease-abstraction-agent-workflow.svg)

## What's in here

- `posts/`: the posts in Markdown.
- `diagrams/`: the before/after diagrams, as SVG, plus the JSON spec each one is drawn from.
- `scripts/render-diagrams.mjs`: redraws every SVG from its spec, with no dependencies (`node scripts/render-diagrams.mjs`).
- `BRIEF.md`: the template each post follows, so you can write your own.

## Honesty note

The firms are composites. The volumes are typical for each segment, and every cost is computed from Claude API list prices on 10 November 2026. Labour rates and volumes are stated assumptions. Check prices at https://platform.claude.com/docs/en/about-claude/pricing before you rely on them.

## Run your own numbers

The free tools at https://seyhunakyurek.com/tools are open source too: https://github.com/seyhunak/ai-buyer-tools

## License

Text and diagrams: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit "Seyhun Akyürek, https://seyhunakyurek.com". Scripts: MIT.

Written by [Seyhun Akyürek](https://seyhunakyurek.com). If you want this done on your own process, [get in touch](https://seyhunakyurek.com/contact).
