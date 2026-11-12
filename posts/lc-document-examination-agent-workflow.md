---
title: "Letter of credit checking against a five-day clock: five agents, two human sign-offs and a 31-cent API bill per presentation"
date: 2026-11-12
summary: Five Claude agents prepare letter of credit presentations for a checker's decision at about 31 cents of API cost each, cutting modelled staff time from 95 to 25 minutes.
short_title: "LC document checking: agents, sign-offs and API costs"
description: "Five Claude agents prepare LC presentations for a checker's decision at 31 cents each, cutting 95 staff minutes to 25."
tags: [agent-architecture, trade-finance, lc-document-examination, api-costs]
---

> Also published at https://seyhunakyurek.com/blog/lc-document-examination-agent-workflow

A documentary credit pays against paper, not goods. When an exporter presents an invoice, bill of lading, packing list, certificate of origin, insurance certificate, inspection certificate and draft, the bank must decide whether they comply with the credit. UCP 600 Article 14(b) gives it a maximum of five banking days following the day of presentation. A late refusal, or a notice that misses a discrepancy, can leave the bank unable to refuse at all.

The bank here is a mid-sized UAE commercial bank that issues import credits and acts as nominated or confirming bank on export credits. I assume about 2,000 presentations a month, averaging eight documents and 24 pages each. Checkers compare every document with the credit and with each other, following ISBP 821, the ICC's examination practice. Trade compliance screens every party, vessel, port and line of goods. At about 95 minutes of staff time per presentation, that is roughly 3,170 hours a month.

In this design, agents do the reading and propose discrepancies with citations. A checker decides every presentation, and a compliance officer clears every screening hit.

The bank here is a composite: the volumes are typical for a mid-sized UAE trade finance operation, and every cost below is computed from Claude API list prices on 10 November 2026.

## the process today

![Letter of credit document examination before and after: eight manual steps by trade operations clerks, document checkers, a senior checker and trade compliance taking about 95 minutes per presentation on the left; on the right, a nine-step workflow of deterministic code, five Claude agents and two human checkpoints taking about 25 minutes of human time per presentation](../diagrams/lc-document-examination-agent-workflow.svg)

| step | who | minutes |
|---|---|---|
| Receive the courier presentation, stamp the date of receipt, count originals and log it | Trade ops clerk | 6 |
| Scan and index the documents; pull the credit and its amendments | Trade ops clerk | 6 |
| Check each document against the credit terms under UCP 600 and ISBP 821 | Document checker | 32 |
| Cross-check data between documents and recompute the invoice arithmetic | Document checker | 14 |
| Screen parties, vessels, ports and goods against sanctions and dual-use lists | Trade compliance analyst | 12 |
| Review trade-based money laundering red flags: pricing, routing, customer profile | Trade compliance analyst | 7 |
| Four-eyes review of the examination; decide to honour or refuse | Senior checker | 10 |
| Draft the refusal notice or waiver request, or the settlement instruction (averaged) | Document checker | 8 |
| **total** | | **95** |

Most of the checker's 46 minutes is comparison. "About" allows 10% either way under Article 30. The invoice must describe the goods as the credit does (Article 18(c)); other documents may use general terms that don't conflict (Article 14(e)). Insurance must cover at least 110% of the CIF or CIP value from no later than shipment (Article 28). None of this is hard alone. The errors come from volume and from data spread over eight documents: a port spelled two ways, a weight that differs between packing list and bill of lading. Checkers also over-call. Under ISBP 821, a typing error that doesn't affect meaning is not a discrepancy, and a refusal for one costs a customer argument. Compliance has the opposite problem: a vessel that changed its name looks clean on paper.

## the agent architecture

The pattern is a pipeline with a fan-out. Each presentation goes through intake, classification, extraction, rules and examination in a fixed order, because nobody should reason about a discrepancy before the data exists. Extraction fans out to one call per document. Screening and the TBML review run beside the examination, because a sanctions hit stops the presentation whatever the documents say. An orchestrating LLM would add cost without adding a decision.

Intake, OCR, date and amount checks, list screening and escalation rules are plain code. Every stage writes a typed record to the trade finance system (Finastra, Surecomp, China Systems or in-house), so any stage can rerun alone.

### intake and OCR (deterministic)

The clerk still receives, stamps and scans the paper, about 5 minutes. Code registers the presentation, runs OCR, pulls the credit (MT700) and amendments (MT707s), and sets the deadline: close of the fifth banking day after presentation, on the UAE banking calendar.

### document classifier

- **Job:** group pages into documents, label each type, and list anything field 46A calls for that is missing.
- **Model:** Haiku 5.5. Short classification on every presentation.
- **Inputs and outputs:** the first 300 tokens of each page and a cached taxonomy; returns page groups with confidence. No tools.
- **Guardrails:** below 0.9 confidence on any page, the clerk confirms the split. A document is never marked missing until the clerk has checked the physical bundle.

### field extractor

- **Job:** pull each document's fields (parties, goods, quantities, prices, ports, dates, vessel and IMO number, on-board notation, clauses, originals), each with a page and line citation.
- **Model:** Sonnet 5.5. Stamps and messy layouts need a capable reader. One call per document, about eight per presentation.
- **Inputs:** the document's OCR text, the credit terms (cached across the eight calls) and a cached schema.
- **Guardrails:** code checks every value appears at its cited location. A failure, or confidence under 0.85, goes to the checker as "verify against the original".

### rules engine and screening (deterministic)

Code checks dates against the latest shipment date, presentation period and expiry; amounts against the credit and its tolerance; invoice arithmetic; insurance cover; originals; and every numeric field across documents. It also sends every party, bank, vessel IMO number, port and goods description to the bank's screening vendors: a name-screening service (World-Check, Dow Jones or LexisNexis), a maritime data provider for vessel ownership, flag history and port calls, and the bank's dual-use and strategic goods lists. No model decides whether a name matches.

### discrepancy examiner

- **Job:** the judgement calls. Does the invoice's goods description correspond with the credit? Does the certificate of origin conflict with the bill of lading, or merely differ? Is a notation a clause that makes the bill unclean? Is a condition in 47A non-documentary, to be disregarded under Article 14(h)? It returns proposed discrepancies with citation, the UCP 600 article or ISBP 821 paragraph relied on, and a confidence score.
- **Model:** Opus 5.5. A missed discrepancy means paying against non-compliant documents; a false one means a wrongful refusal.
- **Inputs:** all extracted fields, the credit, the rules results and a cached 15,000-token examination guide written by the bank's senior checkers and keyed to ISBP 821.
- **Guardrails:** it proposes, never decides. Code rejects any proposal whose citation doesn't resolve. It also lists what it checked and found compliant.

### TBML reviewer

- **Job:** read the trade as a compliance analyst would: unit price against reference prices, an odd route, transhipment through a high-risk port, goods that don't fit the applicant's business, unexplained third parties. The indicators follow FATF guidance and the Wolfsberg Group's trade finance principles.
- **Model:** Sonnet 5.5 through the Batch API. It is off the checker's critical path, and batch results typically return within hours, well inside five days.
- **Guardrails:** it can raise a flag, never clear one. Every flag goes to compliance.

### notice drafter

- **Job:** draft the single refusal notice Article 16(c) requires (that the bank refuses, each discrepancy, and the status of the documents) in MT734 form, or, for an issuing bank, the waiver request to the applicant under Article 16(b), which does not extend the five days.
- **Model:** Sonnet 5.5. Drafting from confirmed facts into templates.
- **Guardrails:** it lists only discrepancies the checker confirmed. Code checks each appears exactly once with the right references.

### human checkpoints and escalation

- **Trade compliance officer:** clears or escalates every screening hit and TBML flag. I assume potential hits on 15% of presentations, mostly common names and similar vessel names, and red flags on 8%. A confirmed sanctions match leaves the workflow for compliance and legal; no agent drafts anything for it.
- **Checker and senior checker:** a person decides every presentation. The checker reviews each proposal against the cited page, adds or removes discrepancies, and decides to honour, refuse or seek a waiver. The senior checker signs off refusals and large amounts.
- **Policy rules** escalate regardless of confidence: one banking day to the deadline, a credit over $5 million, an amendment not yet accepted by the beneficiary, or an unplaced page.

## the exact flow

1. The clerk scans the presentation; code registers it, runs OCR and sets the deadline. Unreadable pages go back for a rescan.
2. The classifier groups pages in real time. Low-confidence pages wait for the clerk.
3. The extractor runs per document in parallel. A failed call retries twice with backoff, then goes to the checker for manual entry.
4. The rules engine runs and sends every name, vessel, port and goods line to screening. A potential hit opens a compliance task at once.
5. The examiner runs on the full record. A response failing schema or citation checks is regenerated once; if it fails again, the checker examines that presentation by hand.
6. The TBML review joins the next batch job. Anything not back in six hours, or within two banking days of the deadline, reruns in real time.
7. Compliance clears or escalates. A presentation with an open hit cannot be honoured.
8. The checker decides; the senior checker signs off refusals and large amounts.
9. The drafter writes any notice from the confirmed list; the checker approves and sends it.
10. Code alerts at the start of day four on anything undecided. Every prompt, output, model version, edit and decision is kept with the file.

## the api costs

Tokens are per call; cost is per presentation. The input column includes cached tokens. Output includes thinking: about 2,500 tokens for the examiner and 500 to 600 for the Sonnet steps.

Presentations are processed in half-hourly waves, so prefixes stay warm. I assume one cache write per 10 calls for the classifier and examiner, one per eight extractor calls (the credit terms are written once per presentation), one per four drafter calls, and one per five TBML calls, since batch cache hits are best effort. Only the TBML review is batched; everything else is on the checker's critical path.

| agent | model | input tokens | cached input tokens | output tokens | cost per unit |
|---|---|---|---|---|---|
| Document classifier (1 call) | Haiku 5.5 | 9,200 | 2,000 | 400 | $0.000963 |
| Field extractor (8 calls) | Sonnet 5.5 | 9,400 | 7,000 | 1,000 | $0.140800 |
| Discrepancy examiner (1 call) | Opus 5.5 | 28,500 | 15,000 | 4,000 | $0.144200 |
| TBML reviewer (1 call, batch) | Sonnet 5.5 | 9,000 | 4,000 | 1,200 | $0.012160 |
| Notice drafter (0.55 calls) | Sonnet 5.5 | 7,000 | 3,000 | 1,500 | $0.013805 |
| **total per presentation** | | | | | **$0.311928** |

The examiner row, worked through: 13,500 uncached input tokens at $4.00 per million is $0.054. The 15,000 cached tokens bill at 90% reads ($0.20) and 10% writes ($5.00), an effective $0.68 per million, so $0.0102. The 4,000 output tokens at $20.00 per million are $0.080. That is $0.1442 a call, one call per presentation, $288.40 a month.

At 2,000 presentations the API bill is **about $624 a month** across 23,100 calls: examiner $288.40, extractor $281.60, drafter $27.61, TBML reviewer $24.32, classifier $1.93. The drafter's 0.55 assumes 55% of presentations are discrepant. Without caching or batching it would be about $943.

| line | monthly |
|---|---|
| Claude API (all agents) | $623.86 |
| OCR, about 48,000 pages (estimate) | $72 |
| Hosting: queue, workers, database (estimate) | $500 |
| Document and audit log storage (estimate) | $150 |
| Observability and LLM tracing (estimate) | $400 |
| Vessel and price reference data (estimate) | $600 |
| **total running cost** | **$2,345.86** |
| Staff time today (95 min × 2,000) | 3,166.7 hours |
| Staff time after (24.85 min × 2,000) | 828.3 hours |
| **Modelled hours saved** | **2,338.4 hours** |
| Labour value at $40/hour | $93,536 |

That is about $1.17 of running cost per presentation, excluding the name-screening licence the bank already pays for. The $40 is my blended, fully loaded UAE rate for checkers and compliance analysts, including housing and visa costs. The 24.85 minutes is 5 for the clerk's scan; checker review of 8 minutes on compliant presentations (45%) and 15 on discrepant ones (55%); 10 minutes of extraction fixes on 10%; 4 minutes of senior sign-off averaged; 12 minutes on the 15% with screening hits; and 15 on the 8% with red flags. The hours are capacity, not a headcount plan.

## what it will get wrong

- **Over-calling.** Careful readers flag every difference. The guide states ISBP 821's rule that data need not be identical, only not conflicting. Checkers remove weak proposals, and those removals feed the golden set.
- **A cross-document miss on page 19.** The rules engine compares every numeric field across documents in code first, so the model isn't the only check.
- **A misread stamp.** On-board notations are often stamped. Code verifies each cited value; anything unreadable goes to the checker with the image.
- **A renamed vessel.** Screening runs on the IMO number, which stays with the hull. A missing IMO number opens a compliance task.
- **Dual-use goods behind a generic description.** "Electronic components" in a category the bank marks sensitive always goes to compliance.
- **Instructions hidden in a document.** Document text is data. No agent can honour, refuse, send or clear, so the worst case is a wrong proposal a checker reviews.
- **The clock.** The day-four alert, the real-time fallback and the manual path mean a person always has the file in time.

## how you know it works

Build a golden set of 600 past presentations from the last 18 months, stratified by product (import, export, confirmed), goods and outcome, including every disputed refusal and every compliance hit. Two senior checkers, ideally CDCS-qualified, examine each independently and agree a reference answer. Seed 100 documents with known discrepancies and 50 with known non-discrepancies, such as harmless typing errors.

The bar for go-live:

- **Discrepancy recall:** 98% of reference discrepancies proposed, and 100% of seeded ones.
- **Discrepancy precision:** at least 85% of proposals upheld. Below that, checkers spend their time deleting.
- **Agreement:** Cohen's kappa of at least 0.80 between the examiner and the reference on compliant versus discrepant, per document, and no lower than the two senior checkers' kappa with each other.
- **Field-level accuracy:** 99.5% on amounts, dates, quantities, ports and IMO numbers.
- **Screening routing:** 100% of seeded sanctions, vessel and dual-use cases reach compliance. Pass or fail.
- **Cycle time:** 90% of presentations ready for the checker within four working hours of scanning; 100% decided before the deadline in shadow mode.

Governance is the other gate. The bank stays responsible for its examination and its sanctions compliance. Expect the workflow to fall under the Central Bank's model management and outsourcing rules, with validation and change control for prompts and model versions, and a data-residency review of the API route before the pilot.

## the build plan

- **Week 1:** map products, SWIFT flows and the trade system; write the checkers' playbook against ISBP 821; pull the golden set.
- **Week 2:** intake, OCR, credit parsing and the banking-day calendar.
- **Week 3:** classifier and extractor, scored field by field.
- **Week 4:** rules engine and screening integration, tested without any model.
- **Week 5:** examiner, reviewed proposal by proposal with two senior checkers.
- **Week 6:** TBML reviewer, compliance queue and notice drafter.
- **Weeks 7 to 8:** shadow mode on live presentations, compared daily with the checkers.
- **Week 9:** validation and outsourcing review; go live on export presentations with every result checked in full.
- **Week 10:** add imports; handover with runbook, dashboards and monthly golden-set runs.

## run your own numbers

The [AI token cost estimator](https://seyhunakyurek.com/tools/ai-token-cost-estimator?model=claude-sonnet-5-5&requests=23100&input=10887&output=1249&cached=63&batch=9) is pre-filled with this workload averaged across agents: 23,100 calls a month, 10,887 input and 1,249 output tokens per call, 63% of input cached, 9% of calls batched. It prices every call at Sonnet 5.5, so it reads differently from the mixed-model table.

To measure how often the examiner agrees with your checkers beyond chance, use the [LLM judge agreement calculator](https://seyhunakyurek.com/tools/llm-judge-agreement-calculator), which computes Cohen's kappa from paired calls. To size the checker and compliance queues, use the [human review staffing calculator](https://seyhunakyurek.com/tools/human-review-staffing-calculator).

If you want this mapped onto your trade system, checker playbook and screening stack, [book a call](https://seyhunakyurek.com/contact).
