---
title: "I re-engineered P&C claims intake (first notice of loss) using an autonomous agent workflow. Here is the exact architecture and the API costs."
date: 2026-11-10
summary: A five-agent FNOL intake workflow for 9,000 motor and home claims a month, modelled at about $0.28 of API cost per claim and $2,517 a month.
short_title: "Claims intake (FNOL): agent architecture and API costs"
description: "A five-agent FNOL intake workflow for 9,000 motor and home claims a month, at about $0.28 of API cost per claim."
tags: [agent-architecture, insurance, claims-intake, api-costs]
---

> Also published at https://seyhunakyurek.com/blog/insurance-claims-intake-agent-workflow

First notice of loss is where every claim starts, and in most regional insurers it is still a reading job. A claim arrives as an email with six photos, a web form with half the fields blank, or a call-centre note typed while the customer was upset. Someone has to read all of it, find the policy, set the claim up, check cover, look for fraud indicators, decide how serious it is and get it to the right adjuster.

That someone is usually a claims assistant, and the queue never stops. When it backs up, customers wait, adjusters get thin files, and fraud signals sit unread in attachments.

The workload I model here is a regional UK property and casualty insurer handling about 9,000 motor and home claims a month, arriving by email, web form and call-centre notes, with photos, police reports and repair estimates attached.

The insurer here is a composite: the volumes are typical for the segment, and every cost below is computed from Claude API list prices on 10 November 2026.

## the process today

![Before and after diagram of P&C first notice of loss intake: on the left, eight manual claims-assistant steps taking about 34 minutes per claim; on the right, a nine-step workflow of intake code, classifier, extractor, coverage-check, fraud-signal and triage agents, with a claims handler and adjuster as human checkpoints](../diagrams/insurance-claims-intake-agent-workflow.svg)

| step | who | minutes |
|---|---|---|
| Open the email, web form or call note and its attachments; file them | Claims assistant | 4 |
| Find the policy; confirm it was in force on the loss date | Claims assistant | 4 |
| Set up the claim: date, place, cause, parties, vehicles or property | Claims assistant | 8 |
| Read the schedule and wording; check peril, exclusions, excess, limits | Claims assistant | 6 |
| Review photos, police report and repair estimate; note gaps | Claims assistant | 5 |
| Check fraud indicators: recent inception, late notice, prior claims, story fit | Claims assistant | 3 |
| Set the severity band and route to an adjuster queue | Claims assistant | 2 |
| Send the acknowledgement and request missing documents | Claims assistant | 2 |
| **total** | | **34** |

At 9,000 claims a month that is 5,100 hours of intake work, roughly 36 people at 140 productive hours each. The time goes into two places. The first is re-keying: the claim set-up step alone is 8 minutes of copying dates, registration numbers and addresses from free text into the claims system. The second is reading wording, where an assistant has to hold the loss facts in their head while scanning a 40-page policy document for the escape-of-water exclusion or the unattended-vehicle clause. The errors cluster there too: transposed registrations, a loss date taken from the email instead of the narrative, an endorsement nobody opened, a prior claim never connected.

## the agent architecture

The design is a pipeline with one fan-out. Intake, classification and extraction must run in order, because each needs the previous step's output. Once the facts and the policy are in hand, the coverage check and the fraud screen are independent, so they run in parallel. Triage waits for coverage and for the deterministic fraud rules, but not for the slower fraud narrative review. I chose a pipeline over an orchestrator because the steps are fixed and auditable: every claim takes the same path, and audit can see what each stage saw and produced.

Four parts are plain code, not an LLM: the intake watcher and OCR, the policy lookup, the fraud rules engine, and the queue assignment from the authority matrix.

### intake (deterministic code)

A service watches the claims inbox, the web form endpoint and the call-centre CRM's note export. It OCRs documents, reads photo metadata, and dedupes on policy number, registration or postcode plus loss date, so a customer who emails and then phones does not create two claims. No model call.

### classifier agent

- **Job:** label the notice: motor or home, loss type (collision, theft, escape of water, storm, fire and so on), the document types attached, and urgency.
- **Model:** Haiku 5.5. This is a short classification over a fixed label set; it does not need a bigger model.
- **Inputs:** the notice text, OCR of the first pages of each document, image captions.
- **Outputs:** labels with confidence, plus two hard flags: injury mentioned, and home uninhabitable or vulnerable customer indicators.
- **Guardrails:** the label set is closed. Any urgency flag routes the claim to the front of the human queue regardless of what later agents say. Confidence under 0.8 on line of business sends it to a person before extraction.

### extractor agent

- **Job:** pull the FNOL record: loss date and time, location, cause narrative, insured and third parties, vehicles (registration, make, model) or property details, police reference, emergency services, damage description, repairer and estimate amount.
- **Model:** Sonnet 5.5. Extraction across messy text, scanned forms and photos is its tier; I include a thinking allowance for conflicting dates.
- **Inputs:** everything from intake, including up to four photos.
- **Outputs:** a JSON record where every field carries a source citation (document and page, or "customer email, paragraph 2"), and a list of missing items.
- **Tools:** none with write access. Code validates the schema and format-checks dates, registrations and postcodes.
- **Guardrails:** a field with no citation is left blank, not guessed. Where two sources disagree (the form says 14 March, the police report says 13 March) it returns both and flags the conflict.

### policy lookup (deterministic code)

An API call to the policy administration system (Guidewire, Duck Creek or an in-house platform, depending on the insurer) fetches the policy as it stood on the loss date: schedule, endorsements, excess, named drivers, sums insured, and the policyholder's claim history. If no policy matches, the claim stops and goes to a person. No model guesses which policy a claim belongs to.

### coverage-check agent

- **Job:** compare the loss facts to the policy wording: does the peril appear covered, which exclusions or conditions might apply, and which excess and limits are relevant.
- **Model:** Opus 5.5. This is the judgement-heavy step: noticing that "left the keys in the car" touches the theft condition. It gets the largest thinking allowance.
- **Inputs:** the extracted record, the schedule and endorsements, and the full policy wording for that product version, which is the cached part of the prompt.
- **Outputs:** one of "appears covered", "coverage question" or "possible exclusion", each with clause citations and a plain-English reason.
- **Guardrails:** it never denies cover and never writes to the claim's coverage status. "Possible exclusion" always goes to a person. Any claim where the policy version or endorsements could not be loaded is marked "coverage question" by code, not by the model.

### fraud-signal agent

- **Job:** collect fraud indicators so a person can judge them. Code first: a rules engine checks inception within 30 days of loss, late notification, prior claims of the same type, cover changes shortly before the loss, photo dates that predate the stated loss, and matches against the insurer's industry fraud database checks (in the UK, typically the CUE and IFD lookups the insurer already runs). Then the model reads the narrative against the evidence for inconsistencies the rules cannot see.
- **Model:** Sonnet 5.5, through the Batch API. The rules run instantly and are what triage uses; the narrative review can wait a few hours, because nothing is paid or refused at intake. Most batches return within an hour.
- **Inputs:** the extracted record, rule hits, claim history, the insurer's fraud indicator guide (cached).
- **Outputs:** a score band (low, medium, high) with each indicator and its evidence.
- **Guardrails:** the output is a list of signals, never a conclusion. It does not touch the customer conversation, and the word "fraud" never appears in anything the customer sees. A high band places the file in the special investigations unit (SIU) queue for a person to decide. Because a score can affect how a customer is treated, no decision is made solely by automated means; that keeps the design on the right side of UK GDPR Article 22, though the insurer's DPO should confirm it for their own processing.

### triage agent

- **Job:** set a severity band (1 to 4), suggest the handling queue, and draft the acknowledgement from approved templates, including the list of missing documents.
- **Model:** Haiku 5.5. The rubric and the templates do the heavy lifting; this is classification and template filling.
- **Inputs:** classifier labels, the extracted record, the coverage outcome and the fraud rule hits.
- **Outputs:** severity band with reasons, queue suggestion, acknowledgement draft.
- **Guardrails:** hard rules override it in code: any injury, any uninhabitable home, or an estimate above £25,000 is band 4. The queue is then picked by a lookup against the authority matrix, not by the model.

### where the humans sit

There are two human checkpoints, and they are not optional.

1. **Claims handler review.** Every claim lands in a review queue as a one-page intake summary with citations. Clean claims (high extraction confidence, "appears covered", low fraud band, no urgency flag) take about 2 minutes to check and release. Anything with a conflict, a coverage question, a possible exclusion, a medium or high fraud band, or extraction confidence below 0.85 on any key field takes longer. The handler also approves the acknowledgement before it is sent.
2. **Adjuster and SIU.** Reserves, payments and denials stay with the adjuster, exactly as today. High fraud bands go to SIU. The agents have no write access to payments or claim decisions.

Averaged across the mix, I expect about 5 minutes of handler time per claim, plus about 15 minutes of SIU time on the roughly 4% of claims flagged high, which is 0.6 minutes per claim. Call it 6 minutes.

## the exact flow

1. A notice arrives by email, web form or call-centre note. Intake OCRs it, reads photo metadata and checks for a duplicate. A duplicate is attached to the existing claim and stops here.
2. The classifier labels it. If confidence on line of business is below 0.8, it goes to a person to label, then continues.
3. Urgency flags (injury, uninhabitable home, vulnerable customer) move the claim to the top of the handler queue immediately, in parallel with the rest of the flow.
4. The extractor builds the cited FNOL record. If the schema check fails, it retries once with the validation errors in the prompt; a second failure sends the claim to manual set-up.
5. Policy lookup fetches the policy as at the loss date. No match, or a lapsed policy, stops automation and routes to a handler.
6. The coverage check and the fraud rules run in parallel. The fraud narrative review is queued to the Batch API.
7. If the coverage agent times out or returns malformed output, it retries once; after that the claim is marked "coverage question" and continues.
8. Triage sets the severity band and drafts the acknowledgement; code applies the overrides and picks the queue.
9. The claim, with its summary and flags, lands in the handler queue. The handler corrects anything wrong, approves the acknowledgement and releases the claim. Only then is the claim record written to the claims system, through its API, under the handler's name.
10. When the batch fraud review returns, its signals attach to the claim file. A high band notifies SIU and the assigned adjuster. If a batch fails, the job is resubmitted; claims older than 24 hours without a fraud review are listed for a person.
11. Every model input, output, prompt version and handler correction is logged, so each claim's intake can be replayed.

## the api costs

Per claim, with the cached part of each prompt shown separately:

| agent | model | input tokens | cached input tokens | output tokens | cost per unit |
|---|---|---|---|---|---|
| Classifier | Haiku 5.5 | 4,000 | 3,000 | 300 | $0.0006 |
| Extractor | Sonnet 5.5 | 18,000 | 6,000 | 2,800 | $0.0660 |
| Coverage-check | Opus 5.5 | 6,000 | 30,000 | 4,500 | $0.1632 |
| Fraud-signal (Batch API) | Sonnet 5.5 | 12,000 | 5,000 | 2,700 | $0.0282 |
| Triage | Haiku 5.5 | 5,000 | 4,000 | 800 | $0.0010 |
| **subtotal** | | | | | **$0.2590** |
| Retries (8% allowance) | | | | | $0.0207 |
| **total per claim** | | | | | **$0.2797** |

"Input tokens" here is the uncached part: the notice, documents, photos and extracted record. The extractor's 18,000 includes four photos at roughly 1,600 tokens each. Output includes a thinking allowance: about 1,000 tokens for the extractor, 3,000 for coverage, 1,500 for fraud.

Caching works because system prompts, the schema, the fraud guide and above all the policy wording repeat. A 5-minute cache expires at quiet times, and the coverage cache is split across wordings, so I assume a 90% hit rate for the classifier, extractor and triage, 70% for coverage, and 60% for fraud, where batch cache hits are best effort. A miss pays the cache-write rate on the prefix instead of the read rate, which is how the writes are amortised.

The coverage row, worked through: 6,000 uncached input tokens at $4.00 per million is $0.0240. The 30,000-token wording prefix is read from cache 70% of the time at $0.20 and written 30% of the time at $5.00, a blended $1.64 per million, so $0.0492. Output is 4,500 tokens at $20.00 per million, $0.0900. Together: $0.1632. The fraud row is computed the same way and then halved for the Batch API.

The fraud narrative review is the only step on the Batch API, because it is the only one that can wait hours. Everything else feeds the handler queue and runs in real time.

At 9,000 claims a month: 9,000 × $0.2797 = **$2,517 a month** in API spend. The coverage check is 63% of the per-claim cost before retries; that is the right place to spend, because it is the step where a mistake is most expensive.

| item | monthly |
|---|---|
| Claude API (modelled above) | $2,517 |
| OCR, about 108,000 pages at $1.50 per 1,000 (estimate) | $162 |
| Hosting for intake, queue and review UI (estimate) | $400 |
| Document and photo storage (estimate) | $150 |
| Observability and logging (estimate) | $250 |
| **total running cost** | **$3,479** |
| Intake hours today (34 min × 9,000) | 5,100 h |
| Human hours after (6 min × 9,000) | 900 h |
| **modelled hours saved** | **4,200 h** |
| Labour value at $32 an hour, fully loaded UK claims assistant (assumption) | $134,400 |

That labour value is capacity, not cash; some of it goes to faster contact on serious claims. The all-in running cost works out to about $0.39 per claim against about $18 of assistant time per claim today.

## what it will get wrong

- **Wrong loss date.** Customers write "last night" in an email sent after midnight, and the police report may differ by a day. The extractor returns both sources when they conflict, and code checks the loss date against the email timestamp and policy dates. A loss date within 3 days of inception or lapse always goes to a person.
- **Matching the wrong policy.** Two policies at one address, or a named driver claiming on someone else's car. Lookup is deterministic and stops on any ambiguity; the model never chooses.
- **Over-reading an exclusion.** The coverage agent may flag "unattended vehicle" on a theft from a locked car on a driveway. That is acceptable by design: a false "possible exclusion" costs a handler two minutes, while a missed one costs much more. I track the false-flag rate and tune the prompt when it rises.
- **Missing an exclusion in an endorsement.** If endorsements fail to load, code forces "coverage question". The golden set includes endorsement-driven cases specifically.
- **Fraud bias.** A model reading narratives can react to writing style, language or postcode. The model must cite evidence for every signal, score bands are reviewed by customer segment monthly, and a person decides every referral.
- **Prompt injection in documents.** A repair estimate could carry text aimed at the model. Agents have no write tools and no ability to send messages, and their outputs are schema-checked, so the worst case is a wrong field that a handler sees with its citation.
- **Silent drift.** A new wording or form layout lowers accuracy without errors. Handler corrections are logged per field, and a weekly report flags any field whose correction rate rises.

## how you know it works

Before go-live I build a golden set of **600 historical claims** with known outcomes, 350 motor and 250 home, over-sampling hard cases: injuries, theft, escape of water, SIU referrals and exclusion declines. Experienced handlers label the fields, coverage outcome, severity band and queue.

Metrics and the bar I'd want before going live:

| metric | acceptance bar |
|---|---|
| Field-level accuracy on key fields (loss date, policy, registration or address, cause) | ≥ 98% |
| Field-level accuracy on all extracted fields | ≥ 95% |
| Coverage: recall of known exclusions and declined claims | ≥ 97% |
| Coverage: "appears covered" on claims later declined | ≤ 1% |
| Fraud: recall of claims later referred to SIU | ≥ 85%, with a high-band rate under 6% |
| Urgency flags (injury, uninhabitable) | 100% recall |
| Severity band within one band of the handler label | ≥ 95% |
| Escalation rate to manual handling | ≤ 30% in pilot |
| Notice-to-adjuster cycle time | median under 2 working hours |

Then a two-week shadow run on live claims, where the workflow runs alongside the current team and nothing it produces is used. The pilot starts only if shadow-run numbers match the golden set.

## the build plan

- **Week 1:** Map the intake channels, the claims system and policy admin APIs, and the authority matrix. Pull the 600 golden-set claims and start labelling. Agree on data handling with the DPO.
- **Week 2:** Build intake: inbox and form watchers, call-note export, OCR, dedupe. Build the policy lookup.
- **Week 3:** Classifier and extractor with schema validation and citations. First accuracy run on the golden set.
- **Week 4:** Coverage-check agent on motor and home wordings, with caching per wording version. Fraud rules engine and the batch narrative review.
- **Week 5:** Triage agent, overrides and queue lookup. The handler review screen with citations and one-click corrections.
- **Week 6:** Full golden-set evaluation; tune prompts against the acceptance bar. Security review of credentials and access.
- **Weeks 7–8:** Shadow run on live claims. Compare against the handlers' own set-ups field by field.
- **Week 9:** Pilot on motor claims only, one team, with daily review of corrections.
- **Week 10:** Extend to home claims and the remaining teams if pilot metrics hold; hand over monitoring and the drift report.

## run your own numbers

Plug this workload into the [AI token cost estimator](https://seyhunakyurek.com/tools/ai-token-cost-estimator?model=claude-sonnet-5-5&requests=48600&input=18600&output=2220&cached=52&batch=20). The link pre-fills 48,600 calls a month (five agent calls per claim plus retries), an average of 18,600 input and 2,220 output tokens per call, 52% of input cached and 20% of calls batched. It prices everything at one model, so treat it as a rough check against the per-agent table above.

To see whether your own intake process is a good candidate, try the [agent workflow fit scorer](https://seyhunakyurek.com/tools/agent-workflow-fit-scorer).

If you want this mapped against your own claims volumes and systems, [book a call](https://seyhunakyurek.com/contact).
