---
title: "I re-engineered AML alert triage and investigation using an autonomous agent workflow. Here is the exact architecture and the API costs."
date: 2026-11-11
summary: A six-agent workflow that prepares AML alerts for analyst decision at about 6.5 cents of API cost each, cutting staff time from 60 to a modelled 17 minutes.
short_title: "AML alert triage: agent architecture and API costs"
description: "Six agents prepare AML alerts for analyst decision at about 6.5 cents of API cost each, cutting 60 staff minutes to 17."
tags: [agent-architecture, banking, aml-compliance, api-costs]
---

> Also published at https://seyhunakyurek.com/blog/aml-alert-triage-agent-workflow

Transaction-monitoring rules are tuned to miss nothing, so most alerts are ordinary: a salary paid twice, a seasonal spike, money moved between a customer's own accounts. Someone still has to open each one, pull the file, read a year of transactions and write down why it is fine.

For a mid-sized retail and SME bank in the UAE, I assume about 6,000 alerts a month, around 95% of them false positives. Level 1 analysts triage, Level 2 investigators take escalations, and the money laundering reporting officer (MLRO) decides what goes to the Financial Intelligence Unit. At about 60 minutes of staff time per alert, that is 6,000 hours a month.

I designed an agent workflow that gathers evidence and drafts reasoning. It never closes an alert or decides to file a suspicious transaction report (STR). A person confirms every disposition, and the MLRO makes every filing decision.

The bank here is a composite: the volumes and false-positive rate are typical for a UAE retail and SME bank of this size, and every cost below is computed from Claude API list prices on 10 November 2026.

## the process today

![Before and after diagram: on the left, eight manual steps for AML alert triage and investigation taking about 60 minutes of staff time per alert on average; on the right, a nine-step agent workflow with two human checkpoints and about 17 minutes of human time per alert](../diagrams/aml-alert-triage-agent-workflow.svg)

| step | who | minutes |
|---|---|---|
| Open the alert; read the rule that fired and the flagged transactions | L1 analyst | 4 |
| Pull the KYC profile, risk rating and expected activity | L1 analyst | 8 |
| Review 12 months of transactions and counterparties | L1 analyst | 12 |
| Run name and adverse media searches | L1 analyst | 6 |
| Write the disposition rationale; close or escalate | L1 analyst | 7 |
| Re-review a 10% sample of closed alerts (20 min each) | QA reviewer | 2 |
| Investigate the 10% escalated (180 min each) | L2 investigator | 18 |
| Write the STR narrative, decide and file for the 2% reported (150 min each) | Investigator and MLRO | 3 |
| **total** | | **60** |

Most of an L1 analyst's 37 minutes is retrieval, not judgement: opening four or five systems, exporting transactions to a spreadsheet, running searches. Errors come from the same place. Under backlog pressure, rationales become boilerplate ("activity consistent with profile") that does not say what was checked, which is exactly what an internal audit or regulator picks apart. The opposite failure is a pattern spread across related accounts, each alert closed separately.

## the agent architecture

The pattern is a router in front of two pipelines. A velocity alert on a low-risk salaried customer needs a short check; cash structuring at an SME with cross-border counterparties needs a careful read. Each lane is a fixed pipeline, because evidence must exist before anyone reasons about it. Each stage writes a typed record to the case manager (NICE Actimize, Oracle FCCM, SAS or in-house), so any stage can rerun alone.

Data pulls, feature calculations, list screening and escalation rules are plain code, not an LLM.

### alert intake and data pull (deterministic)

Code pulls the rule and flagged transactions, the KYC profile with risk rating and expected activity, 12 months of transactions, prior alerts and prior STRs. It computes what an analyst computes by hand: volume against declared turnover, velocity, round and just-below-threshold amounts, new counterparties, high-risk jurisdictions, and linked accounts sharing an address, phone or beneficial owner.

### triage router

- **Job:** label the typology (structuring, rapid movement of funds, trade-based, third-party payments, profile mismatch) and pick a lane.
- **Model:** Haiku 5.5. Classification over a 3,000-token summary plus a cached 4,000-token typology guide, on every alert.
- **Guardrails:** code overrides it. High-risk or PEP customers, prior STRs, high-risk jurisdictions, aggregated value above $250,000, or any terrorist financing indicator force the complex lane. I assume 35% of alerts go there directly.

### adverse media reviewer

Sanctions, PEP and watch-list screening runs through the bank's existing vendor (World-Check, Dow Jones or LexisNexis, for example). That is code. A potential sanctions match leaves this flow for the sanctions team.

- **Job:** for the roughly 25% of alerts with adverse media hits, judge whether each article is about the same entity and relevant to financial crime.
- **Model:** Haiku 5.5 through the Batch API, reading about 10,000 tokens of articles and identifiers.
- **Guardrails:** it can mark a hit "likely not the same entity" but cannot discard it. The analyst sees every hit.

### evidence analyst

- **Job:** compare activity with the customer's profile and write findings, each citing a transaction ID, profile field or document.
- **Model:** two tiers. Routine alerts (65%) run on Haiku 5.5, which also gives the recommendation and confidence for that lane. Complex alerts (40%) run on Sonnet 5.5, which reads messy counterparty patterns better. The overlap is routine alerts Haiku cannot settle at 0.85 confidence; they are promoted and rerun.
- **Inputs:** 14,500 tokens on Haiku and 22,000 on Sonnet, plus the AML policy extract and typology guide (6,000 and 8,000 tokens).
- **Guardrails:** facts only from the evidence pack. Anything else is written as "not in file" and listed as an open question.

### disposition recommender

- **Job:** for the complex lane, weigh the findings against the bank's risk appetite and recommend close or escalate with a confidence score and a cited rationale.
- **Model:** Opus 5.5. Seeing that payments to a free zone supplier fit a trading company's business, but same-day onward transfers abroad do not, is judgement.
- **Inputs:** about 10,000 tokens of findings plus a 12,000-token disposition standard.
- **Guardrails:** the output schema has "close" and "escalate" and nothing else. There is no "file an STR" field. A close is only allowed if every red flag has a cited explanation.

### case and STR drafter

- **Job:** write a case summary for each escalated alert, and, when an investigator recommends filing (about 150 cases a month), draft the STR narrative in the structure the bank uses for the FIU's reporting system, goAML in the UAE.
- **Model:** Sonnet 5.5.
- **Guardrails:** it never contacts the customer or relationship manager. Investigators write any request for information themselves, because a careless question can amount to tipping off.

### verifier

- **Job and model:** Haiku 5.5 checks every amount, date and counterparty in each rationale, summary and narrative against the evidence pack, about 6,750 documents a month.
- **Guardrails:** a mismatch sends the text back once, then to the analyst with the mismatch highlighted.

### human checkpoints and escalation

The L1 analyst confirms or overturns every recommendation. The investigator and MLRO own everything after escalation, including the filing decision. The queue is ordered by recommendation:

- **Close at 0.9 confidence or above (about 70%):** the analyst checks the rationale and cited evidence and confirms, about 3 minutes.
- **Close below 0.9, or a verifier mismatch (about 20%):** full L1 review with the pack already assembled, about 12 minutes.
- **Escalate (about 10%):** straight to an investigator with the case summary, about 90 minutes instead of 180.

QA keeps sampling 10% of closes.

## the exact flow

1. Code pulls data and computes features; a failed pull retries three times, then goes to the manual queue. A potential sanctions match goes to the sanctions team.
2. The router labels and routes in real time; code applies the overrides.
3. Adverse media review, both evidence analysts and the recommender run through the Batch API. A failed request is resubmitted once, then goes to the manual queue.
4. Haiku-lane alerts below 0.85 confidence are promoted and rerun on Sonnet and Opus.
5. The verifier checks each rationale. A mismatch triggers one rewrite, then goes to the analyst.
6. The L1 analyst works the queue and confirms, overturns or escalates. Every override is logged with a reason.
7. For escalations, linked alerts are grouped into one case and the drafter writes the summary when the investigator opens it.
8. If the investigator recommends filing, the drafter writes the STR narrative and the verifier checks it.
9. The MLRO decides and, if filing, submits through goAML. Every prompt, output, model version, override and decision is kept with the case.

## the api costs

Tokens are per call. Cost is per alert, weighted by how many alerts reach that agent. "Input" is uncached input plus cache writes; "cached" is cache reads.

| agent | model | input tokens | cached input tokens | output tokens | cost per unit |
|---|---|---|---|---|---|
| Triage router (1 call per alert) | Haiku 5.5 | 3,000 + 200 write | 4,000 | 250 | $0.00049 |
| Adverse media reviewer (0.25 calls, batch) | Haiku 5.5 | 10,000 | 0 | 400 | $0.00015 |
| Evidence analyst, routine lane (0.65 calls, batch) | Haiku 5.5 | 14,500 + 6,000 write | 0 | 1,200 | $0.00091 |
| Evidence analyst, complex lane (0.4 calls, batch) | Sonnet 5.5 | 22,000 + 8,000 write | 0 | 3,000 | $0.01880 |
| Disposition recommender (0.4 calls, batch) | Opus 5.5 | 10,000 + 12,000 write | 0 | 3,000 | $0.03200 |
| Case summary drafter (0.1 calls) | Sonnet 5.5 | 25,000 + 5,000 write | 0 | 2,500 | $0.00875 |
| STR narrative drafter (0.025 calls) | Sonnet 5.5 | 29,500 + 6,000 write | 0 | 3,000 | $0.00260 |
| Verifier (1.125 calls) | Haiku 5.5 | 8,000 + 160 write | 2,000 | 400 | $0.00117 |
| **total per alert** | | | | | **$0.06487** |

At 6,000 alerts a month, that is **$389.22 a month** in API cost, across about 23,700 calls.

The arithmetic for the recommender: 10,000 uncached input tokens at $4.00 per million is $0.040. Writing the 12,000-token standard to cache costs 12,000 × $5.00 / 1M = $0.060. Output, including about 2,000 thinking tokens, is 3,000 × $20.00 / 1M = $0.060. That is $0.160 a call, halved by the Batch API to $0.080. It runs on 40% of alerts: $0.032 per alert.

Assumptions:

- **Caching.** The router and verifier run in bursts after each monitoring run, so their prompts stay warm; I amortise one cache write over about 20 and 12 calls. The drafters run hours apart, so every call pays a full write.
- **Batch.** Adverse media, both evidence analysts and the recommender use the Batch API, about 43% of calls. Alert SLAs run in days. Cache hits in a batch are best-effort, so I priced full writes and no reads.
- **Thinking.** Output includes about 2,000 thinking tokens for the recommender and 1,000 to 1,500 for Sonnet calls.
- **Without caching or batch,** the workload costs about $0.11 per alert, or $662.76 a month.

| line | monthly |
|---|---|
| API cost (above) | $389.22 |
| Hosting and queue workers, est. | $500 |
| Evidence pack and log storage, est. | $150 |
| Observability and LLM tracing, est. | $400 |
| News search API for adverse media, est. | $300 |
| **total running cost** | **$1,739.22** |
| Modelled staff time saved: (60 − 16.7) min × 6,000 alerts | 4,330 hours |
| Labour value at a blended fully loaded UAE rate of $40 per hour | $173,200 |

That is about 29 cents of running cost per alert. The $40 rate is my UAE assumption for analysts, investigators and QA, including housing and visa costs. The 16.7 minutes is 70% × 3 + 20% × 12 + 10% × 90, plus 2% × 60 for MLRO review and 2 for QA. The hours are capacity, not a headcount plan.

## what it will get wrong

- **Confident closes on real suspicion.** Steady cash deposits that always sit just below the reporting threshold. Caught by code overrides on structuring features, the 0.9 bar, the cited-explanation rule and QA sampling.
- **Missing the network.** Three harmless-looking alerts can share one beneficial owner. Code groups linked accounts before any agent runs.
- **Boilerplate drift.** The verifier rejects any rationale without a cited transaction, and QA reviews a sample for substance.
- **Wrong entity in adverse media.** Common names produce false hits and false dismissals. The reviewer cannot discard a hit.
- **Automation bias.** Override rates per analyst are monitored, and seeded test alerts with known outcomes are mixed into the queue.

## how you know it works

Build a golden set of 1,500 closed alerts from the last 18 months, stratified by typology, segment and outcome, including every alert that led to an STR. Two senior investigators re-label 300, because historical closes are not all right.

- **Escalation recall:** 99% or better, and 100% on alerts that led to an STR.
- **False-close rate** among high-confidence closes: below 0.5%.
- **Field-level accuracy** of amounts, dates and counterparties: 99.5%, with the verifier catching 98% of 200 seeded errors.
- **Narrative quality,** scored blind by the MLRO's team.

Run six weeks in shadow mode and go live only when the bars hold.

Governance is the other gate. Under UAE AML/CFT law and Central Bank guidance, the bank stays responsible for monitoring and reporting, must be able to explain why each alert was closed, and must keep records for at least five years. Expect the workflow to fall under the Central Bank's model management standards, with independent validation, monitoring and change control for prompts and model versions. The tipping-off prohibition shapes the design: no agent writes to customers or front-line staff. Outsourcing and data-residency review of the API route comes before the pilot.

## the build plan

- **Week 1.** Sandbox access, typology guide and disposition standards written down, golden set pulled.
- **Week 2.** Data pull, feature code, linked-account grouping and the screening integration.
- **Week 3.** Router and override rules; first routing accuracy run.
- **Week 4.** Both evidence analysts with citations, and the adverse media reviewer.
- **Week 5.** Recommender, verifier and the analyst queue screen.
- **Week 6.** Case and STR drafters; full golden-set evaluation.
- **Weeks 7 to 8.** Shadow run with four analysts and two investigators; start model documentation.
- **Week 9.** Independent validation and outsourcing review.
- **Week 10.** Go-live on retail alerts, then SME.

## run your own numbers

The [AI token cost estimator](https://seyhunakyurek.com/tools/ai-token-cost-estimator?model=claude-sonnet-5-5&requests=23700&input=14973&output=1090&cached=11&batch=43) is pre-filled with this workload: about 23,700 calls a month, 14,973 average input and 1,090 output tokens per call, 11% of input cached and 43% of calls batched. It prices everything at one model, so it approximates the mixed table.

To size the investigator queue the escalated alerts land in, use the [human review staffing calculator](https://seyhunakyurek.com/tools/human-review-staffing-calculator). To see what routing the easy false positives to Haiku saves against a single tier, try the [AI model routing calculator](https://seyhunakyurek.com/tools/ai-model-routing-calculator).

If you want this mapped onto your bank's monitoring rules and systems, [book a call](https://seyhunakyurek.com/contact).
