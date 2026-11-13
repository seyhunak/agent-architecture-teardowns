---
title: "I re-engineered retail bank complaint handling using an autonomous agent workflow. Here is the exact architecture and the API costs."
date: 2026-11-13
summary: Seven agents prepare retail bank complaints for human sign-off at about 16 cents of API cost each, cutting staff time from 84 to a modelled 26 minutes.
short_title: "Bank complaint handling: agent architecture and API costs"
description: "Agents prepare bank complaints for sign-off at about 16 cents of API cost each, cutting 84 staff minutes to a modelled 26."
tags: [agent-architecture, banking, complaint-handling, api-costs]
---

> Also published at https://seyhunakyurek.com/blog/complaint-handling-agent-workflow

A complaint reaches a retail bank through whichever door the customer found first. An email to the generic inbox. A form in the mobile app. A note typed by a call-centre agent mid-call. A paper form filled in at a branch, sometimes handwritten in Arabic. Each one starts a clock, and each one ends with a letter that has to explain what happened and what the bank will do about it.

For a mid-sized UAE retail bank, I assume about 4,000 complaints a month: disputed card transactions, fees the customer didn't expect, failed transfers, ATMs that kept the cash, loan settlement figures, and service failures. Complaints officers log and classify them, case handlers investigate and draft, team leaders sign off, and a small MI team turns the month's cases into the regulatory return. At about 84 minutes of staff time per complaint, that is 5,600 hours a month.

I designed an agent workflow that does the gathering, the first reading and the first draft. It never decides an outcome and never sends a letter. A case handler confirms every outcome, and a team leader signs every letter.

The bank here is a composite: the volumes and complaint mix are typical for a UAE retail bank of this size, and every cost below is computed from Claude API list prices on 10 November 2026.

## the process today

![Before and after diagram: on the left, nine manual steps for retail bank complaint handling taking about 84 minutes of staff time per complaint on average; on the right, a nine-step agent workflow with two human checkpoints and about 26 minutes of human time per complaint](../diagrams/complaint-handling-agent-workflow.svg)

| step | who | minutes |
|---|---|---|
| Log the complaint from email, app, call notes or a branch form | Complaints officer | 6 |
| Classify product, issue and severity; flag vulnerability; set the SLA date | Complaints officer | 4 |
| Pull statements, card transactions, CRM history and call notes | Case handler | 20 |
| Ask card operations or the branch for what the systems don't show; chase | Case handler | 12 |
| Check the facts against terms and the fee schedule; decide outcome and redress | Case handler | 15 |
| Draft the final response letter in Arabic or English | Case handler | 15 |
| Review the outcome and letter; sign off and send | Team leader | 6 |
| Tag the root cause; compile the monthly regulatory return | Complaints MI analyst | 3 |
| Handle the 5% escalated or referred to Sanadak (60 min each) | Senior handler | 3 |
| **total** | | **84** |

These are blended averages. A reversed ATM fee takes ten minutes; a disputed loan settlement takes most of a day.

The time goes into retrieval: the core banking system for statements, the card system for authorisations and chargebacks, the CRM for earlier contacts, call recordings for what the customer was told. The errors come from the same place. A letter quotes a date copied from the customer's email, not the ledger. A fee refund calculated by hand misses a month. Two complaints about the same card get two different answers from two handlers. And root-cause tags are picked from a dropdown at closing time, so "other" becomes the top cause in the monthly return.

## the agent architecture

The pattern is a router in front of a fixed pipeline. Every complaint goes through intake, classification, the clock and evidence gathering in order, because nobody should reason about a complaint before the evidence exists. Simple complaints (about 60%, such as a duplicated fee) get their recommendation from the evidence gatherer. Standard (30%) and complex ones (10%: vulnerable customers, high values, legal threats, repeat complaints) go to a stronger model. Each stage writes a typed record to the complaints system (Salesforce Financial Services Cloud, Microsoft Dynamics, Pega or in-house), so any stage can be rerun on its own.

Intake, customer matching, the regulatory clock, redress calculations and the regulatory return are plain code, not an LLM.

### intake and normaliser (deterministic)

Code watches the complaints mailbox, the app form, the contact centre's case notes and scanned branch forms, with Arabic and English OCR for the forms. Each item becomes one record. Code matches the customer by CIF, account or card number, Emirates ID or mobile, and links any open complaint on the same product. Low OCR confidence or no match sends the record to a complaints officer, about 10% of items.

### intake classifier

- **Job:** decide whether the item is a complaint (an expression of dissatisfaction) or a service request, and extract the product, issue type, amounts, dates, the remedy the customer is asking for, the language, and vulnerability signals such as age, illness, bereavement or financial hardship.
- **Model:** Haiku 5.5. Short extraction and classification on every item, against a cached 5,000-token taxonomy of products, issue types and root causes.
- **Guardrails:** code assigns the lane, not the model. A vulnerability signal, a mention of a lawyer, the press or the regulator, a value above AED 50,000, or a second complaint on the same issue within 90 days forces the complex lane. An item classed as "not a complaint" below 0.9 confidence is treated as a complaint. Under-recording complaints is the failure a regulator looks for.

### regulatory clock (deterministic)

Code starts the timer when the complaint is first received, not when it is logged. It sends the acknowledgement, tracks the bank's internal SLA and the deadline set by the applicable standard, and alerts the team leader before either is at risk.

The Central Bank of the UAE's Consumer Protection Regulation and its accompanying Standards apply to licensed financial institutions and set expectations for how complaints are received, handled, resolved and reported. I don't hardcode any day count from memory. The bank's compliance team owns the deadlines as configuration, and the clock reads them from there.

### evidence gatherer

- **Job:** collect the facts the complaint turns on, and write an evidence pack where every statement cites a transaction ID, a CRM contact, a call note or a document.
- **Model:** Sonnet 5.5, running a tool-calling loop. Deciding which system to query next, based on what the last query showed, is the part a template can't do.
- **Tools (read-only):** core banking (Temenos, Finastra or Oracle FLEXCUBE) for statements and account events; the card management system for authorisations, reversals and dispute status; the CRM for earlier contacts and complaints; the call recording platform's transcripts; the product terms and fee schedule in force on the transaction date. About five turns per complaint.
- **Outputs:** the evidence pack, the facts it couldn't find, and for the simple lane a recommendation (uphold, partly uphold, not uphold) with a confidence score.
- **Guardrails:** no write tools; it can't reverse a fee, raise a chargeback or contact anyone. A simple-lane recommendation below 0.85 confidence is promoted to the outcome recommender, about 5% of simple complaints.

### outcome recommender

- **Job:** for standard and complex complaints, weigh the evidence pack against the product terms, the fee schedule and the bank's complaints policy, and recommend an outcome with a rationale that cites the evidence.
- **Model:** Opus 5.5. Deciding whether a customer was told clearly enough about a fee, or whether a delay was the bank's fault or the beneficiary bank's, is judgement.
- **Inputs:** about 9,000 tokens of evidence and complaint, and a 15,000-token policy pack.
- **Guardrails:** the model never calculates money. If it recommends redress, it names the basis (refund these fees, recompute interest from this date) and code does the arithmetic from the fee schedule. A "not uphold" recommendation must answer every point the customer raised.

### letter drafter and verifier

- **Job:** once the case handler has confirmed the outcome, draft the final response letter in the customer's language. It explains what the bank found, the outcome, any redress, and the escalation information the bank's policy requires, including that a customer who remains dissatisfied may refer the complaint to Sanadak, the UAE's independent ombudsman unit for banking and insurance complaints, under the conditions Sanadak sets.
- **Model:** Sonnet 5.5, with a cached 8,000-token pack of approved templates and the bank's tone guide in Arabic and English.
- **Verifier:** Haiku 5.5 checks every amount, date, account reference and card number fragment in the letter against the evidence pack and the redress calculation, and checks the required sections are present. A mismatch sends the letter back once, then to the case handler with the mismatch highlighted.
- **Guardrails:** letters show only the last four digits of any card or account number. The drafter can't promise anything the confirmed outcome doesn't include.

### root-cause tagger and monthly summary

- **Job:** on closure, tag a root cause from the bank's taxonomy (process failure, system error, staff error, third party, unclear disclosure, product design, customer error). Once a month, an Opus 5.5 call reads the aggregated tags and writes a trend summary for the complaints committee.
- **Model:** Haiku 5.5 through the Batch API; nobody needs the tags within the hour.
- **Guardrails:** code builds the regulatory return from the records, and the head of complaints signs it off. The model drafts commentary, never reported figures.

### human checkpoints and escalation

The case handler confirms or changes every outcome. The queue is ordered by lane:

- **Simple lane (about 60%):** the handler reads the evidence pack and recommendation and confirms, about 8 minutes.
- **Standard lane (about 30%):** a full review with the pack already assembled, about 25 minutes.
- **Complex lane (about 10%):** the handler owns the investigation, works with the business unit and uses the pack as a starting point, about 60 minutes.

The team leader signs every letter, about 4 minutes. Complaints near their deadline, from vulnerable customers, or escalated by the customer go to a senior handler.

## the exact flow

1. Intake code captures the item, stamps the received time and matches the customer. Unmatched or low-confidence OCR items go to a complaints officer.
2. The classifier extracts fields in real time; code applies the lane overrides. A failed call retries twice, then the item goes to manual classification with the clock already running.
3. The clock sends the acknowledgement and starts the SLA timers.
4. The evidence gatherer runs its tool loop in real time. A failed tool call retries twice; a loop that passes eight turns stops, and the case handler gets a partial pack marked as such.
5. Standard, complex and promoted simple complaints go to the outcome recommender through the Batch API, which typically returns within a few hours. A complaint within two days of its internal deadline skips the batch and runs in real time. A failed batch request is resubmitted once, then the case goes to the handler without a recommendation.
6. The case handler confirms or changes the outcome. Every change is logged with a reason. Code computes any redress.
7. The drafter writes the letter; the verifier checks it. One automatic rewrite on a mismatch, then the handler fixes it.
8. The team leader signs off. The letter goes out through the customer's channel, and any refund is posted by operations staff through the normal maker-checker process, never by an agent.
9. On closure, the tagger runs in the nightly batch. Month end, code builds the regulatory return, the monthly summary is drafted, and the head of complaints signs off. Every prompt, output, model version, override and decision stays with the case.

## the api costs

Tokens are per call. Cost is per complaint, weighted by how many complaints reach that agent. "Input" is uncached input plus cache writes; "cached" is cache reads.

| agent | model | input tokens | cached input tokens | output tokens | cost per unit |
|---|---|---|---|---|---|
| Intake classifier (1 call) | Haiku 5.5 | 2,500 + 200 write | 5,000 | 400 | $0.000525 |
| Evidence gatherer (5-turn loop, real time) | Sonnet 5.5 | 15,600 + 120 write | 58,400 | 3,100 | $0.076140 |
| Outcome recommender (0.43 calls, batch) | Opus 5.5 | 9,000 + 15,000 write | 0 | 3,000 | $0.036765 |
| Letter drafter (1 call) | Sonnet 5.5 | 6,000 + 400 write | 8,000 | 1,800 | $0.031800 |
| Verifier (1.1 calls) | Haiku 5.5 | 9,000 + 120 write | 3,000 | 400 | $0.001259 |
| Root-cause tagger (1 call, batch) | Haiku 5.5 | 4,000 + 4,000 write | 0 | 300 | $0.000525 |
| Monthly trend summary (1 call a month, batch) | Opus 5.5 | 60,000 | 0 | 5,000 | $0.000043 |
| Retries (10% of gatherer and drafter) | Sonnet 5.5 | | | | $0.010794 |
| **total per complaint** | | | | | **$0.157851** |

At 4,000 complaints a month, that is **$631.40 a month** in API cost, across about 40,500 calls.

The arithmetic for the evidence gatherer, the biggest row. Over five turns it sends 74,000 input tokens. A stable 6,000-token prefix (instructions and tool definitions) is read from cache on every turn, 30,000 tokens in all. Each turn also re-reads the conversation so far, another 28,400 tokens, for 58,400 cache reads at $0.10 per million: $0.00584. The 15,600 new tokens (the complaint, then each tool result and the model's previous reply) are written to cache at $2.50 per million, plus an amortised 120 tokens for the prefix itself: 15,720 × $2.50 / 1M = $0.0393. Output is 3,100 tokens, including thinking, at $10.00 per million: $0.031. That is $0.07614 a complaint. Without caching the same loop costs $0.179, because a tool loop resends its whole history every turn.

Assumptions:

- **Caching.** Complaints arrive all day, so prompts stay warm. I amortise one cache write over about 25 classifier calls, 50 gatherer loops, 20 drafter calls and 25 verifier calls.
- **Batch.** The outcome recommender, the tagger and the monthly summary use the Batch API, about 14% of calls. Their results can wait hours. Cache hits in a batch are best-effort, so I priced full writes and no reads.
- **Thinking.** Output includes about 2,000 thinking tokens for the recommender, 1,000 across the gatherer's turns and 600 for the drafter. Arabic letters use more tokens than English ones; the drafter's 1,800 output tokens allow for that.
- **Without caching or batch,** the workload costs about $0.32 per complaint, or $1,272.42 a month.

| line | monthly |
|---|---|
| API cost (above) | $631.40 |
| Hosting and queue workers, est. | $500 |
| Evidence pack, letter and log storage, est. | $150 |
| Observability and LLM tracing, est. | $400 |
| Arabic and English OCR for branch forms, est. | $100 |
| **total running cost** | **$1,781.40** |
| Modelled staff time saved: (84 − 25.8) min × 4,000 complaints | 3,880 hours |
| Labour value at a blended fully loaded UAE rate of $30 per hour | $116,400 |

That is about 45 cents of running cost per complaint. The $30 (about AED 110) per hour is my UAE assumption for complaints officers, case handlers and team leaders, including housing, visa and end-of-service costs. The 25.8 minutes is 60% × 8 + 30% × 25 + 10% × 60 for case handlers, 4 for the team leader, 0.5 for intake exceptions (10% × 5), 1 for MI review and 2 for escalations (5% × 40). The hours are capacity, not a headcount plan.

## what it will get wrong

- **A complaint logged as a service request.** The 0.9 bar treats doubt as a complaint, and QA samples items classed as requests weekly.
- **A wrong figure in the letter.** Amounts come from code and the ledger, and the verifier ties every figure in the letter back to them.
- **A confident "not uphold" that misses a point.** The recommender has to answer every point the customer raised, and the handler sees the customer's original words beside the rationale.
- **A vulnerable customer handled as routine.** Code forces the complex lane on any vulnerability signal, and the classifier is tested on a seeded set of indirect signals ("since my husband passed").
- **A deadline missed while waiting for a batch.** The clock runs in code, and complaints near their deadline skip the batch.
- **Instructions hidden in a customer email.** Complaint text is data. No agent can write to a system, move money or send anything, so the worst case is a bad draft a person rejects.
- **Automation bias.** Override rates per handler are monitored, and seeded test complaints with known outcomes go into the queue.

## how you know it works

Build a golden set of 1,200 closed complaints from the last 12 months, stratified by channel, product, lane, language and outcome, including every complaint later escalated to Sanadak. Two senior handlers re-label 250 of them, because historical outcomes are not all right.

- **Complaint recall:** 99.5% of complaints recognised as complaints, and 100% of seeded vulnerability cases routed to the complex lane.
- **Field-level accuracy** of amounts, dates and references in the evidence pack: 99.5%, with the verifier catching 98% of 200 seeded errors in letters.
- **Outcome agreement** with the re-labelled set: 90% for the simple lane, with every disagreement explained.
- **Escalation rate:** the share of simple-lane cases promoted stays under 10%.
- **Cycle time:** median time from receipt to a letter ready for sign-off under one business day for the simple lane.
- **Letter quality,** scored blind for clarity and tone in both languages.

Run six weeks in shadow mode and go live only when the bars hold.

Governance is the other gate. The bank stays responsible for every outcome under the Consumer Protection Regulation and Standards, and the regulator will expect it to explain how each decision was reached. Expect the workflow to fall under the bank's model risk management, with validation, monitoring and change control for prompts and model versions. Outsourcing and data-residency review of the API route comes before the pilot.

## the build plan

- **Week 1.** Sandbox access to the complaints system, core, cards and CRM; the taxonomy, policy pack and letter templates written down; golden set pulled.
- **Week 2.** Intake code for all four channels, OCR for branch forms, customer matching and the regulatory clock.
- **Week 3.** Classifier and lane rules; first routing accuracy run.
- **Week 4.** Evidence gatherer with read-only tools and citations.
- **Week 5.** Outcome recommender, redress code and the handler queue screen.
- **Week 6.** Letter drafter and verifier in Arabic and English; full golden-set evaluation.
- **Weeks 7 to 8.** Shadow run with six handlers and two team leaders; start model documentation.
- **Week 9.** Validation, compliance review of templates and the clock configuration, outsourcing review.
- **Week 10.** Go-live on cards and fees complaints, then the rest.

## run your own numbers

The [AI token cost estimator](https://seyhunakyurek.com/tools/ai-token-cost-estimator?model=claude-sonnet-5-5&requests=40521&input=13498&output=772&cached=60&batch=14) is pre-filled with this workload: about 40,500 calls a month, 13,498 average input and 772 output tokens per call, 60% of input cached and 14% of calls batched. It prices everything at one model, so it approximates the mixed table.

To size the team of case handlers and team leaders the recommendations land on, use the [human review staffing calculator](https://seyhunakyurek.com/tools/human-review-staffing-calculator). The evidence gatherer is a tool loop and most of the bill; the [agent loop cost calculator](https://seyhunakyurek.com/tools/agent-loop-cost-calculator) shows what more turns or larger tool results do to it. To decide which confidence bands the recommender may settle without a second look, try the [escalation threshold calculator](https://seyhunakyurek.com/tools/escalation-threshold-calculator).

If you want this mapped onto your bank's complaint channels and systems, [book a call](https://seyhunakyurek.com/contact).
