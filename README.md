# Meridian claim readiness

A prototype for the week-2 workshop: an AI agent reads a commercial auto claim across ClaimsPro, Snowflake and Databricks, assembles a readiness packet, and recommends one of five routes. Code rules then apply the regulatory floors, the most conservative route wins, and an adjuster confirms it in one click. Nothing here approves, denies or pays. The decision itself stays in ClaimsPro.

Live: https://meridian-claims-sigma.vercel.app

## Principles

- **The model describes, the code decides.** The agent fills a fixed packet (fields with sources, timeline, contradictions, denial indicators, what is missing) and recommends a route. The routing protocol in `lib/rules/protocol.ts` applies the floors in code. A rule can only move a claim toward more review.
- **No denial from AI.** The route list has no such value. Denial indicators are surfaced for a person, with the evidence and its source.
- **No self-reported confidence.** The three numbers on the audit record are measured: per-field extraction confidence from the OCR engine and re-reads, evidence completeness from the checklist, and route confidence from the evaluation against labelled cases.
- **No client PII in prompts.** Names, phones, emails, dates of birth and addresses are masked before anything reaches the model (`lib/privacy/mask.ts`); a leak check stops a run that would echo a name.
- **Never fail silently, never fake a model call.** Without a key the app shows cached packets and says so; re-run is disabled.
- **Every correction is a test case.** Changing a route needs a reason; the reason is recorded and lands in `eval/cases.csv`.

## The five routes

| Route | Meaning |
|---|---|
| Ready to decide | Complete, consistent, under the ceiling, no floor. The adjuster confirms the decision in ClaimsPro. |
| Request information | Something is missing from the claimant or the shop. A request is drafted. |
| Verify documents | A field or a document needs a person's eyes before the claim can be decided. |
| Specialist review | A senior adjuster: over the simple-claim ceiling or a contradiction the sources cannot settle. |
| Full review | A person adjudicates in full with a written justification: a regulatory threshold or a denial indicator. |

`out_of_scope` is a rules-only exit for Canadian policyholders (residency constraint); it is never a model output and is flagged for review in the protocol.

## The rules (protocol 0.1)

Locked: R1 human review over $10,000 in the threshold states; R2 consent states where consent is not recorded; R3 Canadian residency; D0 policy lapsed at the date of loss; D1 any denial indicator in the packet; G1 guardrails. Configurable with bounds: C1 simple-claim ceiling ($5,000), C2 completeness, C3 weak OCR fields not confirmed by a re-read (0.8), E1 and E2 contradictions. The Routing protocol page renders the same file the code runs.

## Evaluation

**Rules only, on the extract** (5,000 rows, scored on the 500 with a `requires_human_review` label; pinned in `lib/eval/rules-only.test.ts`):

| | Flagged of 5,000 | Missed (needed review, not flagged) | Unnecessary | Regulatory misses |
|---|---|---|---|---|
| Today's flag | 2,280 | 21 of 159 | 63 | 31 of 134 |
| Protocol 0.1, default settings | 2,513 | 34 | 71 | 0 |
| Regulatory floor only (R1, R2, R3) | 1,272 | 88 | 0 | 0 |

The label is set after the fact and tracks the final complexity of the claim; a rule that runs at intake cannot see that. The regulatory floor is exact by construction, which is the point: today's flag misses 31 claims the law requires a person on.

**Packets, on the 14 labelled cases** (`npm run eval`, cached packets, draft labels by one person in `eval/cases.csv`): 10 of 10 claims that must reach a person did; 10 exact and 14 acceptable routes of 14; 0 over-escalated of 4; the fax line that OCR read as `1,B00` re-read as `1,800.00` on both the garbled and the clean copy. Two adjusters labelling independently, with disagreements resolved, is the next step before any of these numbers is quoted.

## Where the data comes from

- `meridian/sample_claims/` and `meridian/reference/claims_processing.csv`: the three claims and the extract Meridian provided. Real model runs, cached in `data/packets/`.
- `sample_claims_variants/`: the three claims edited by `scripts/make-variants.ts` (estimate removed, amount over $10k, Texas with the flag blank, clean OCR, a repainted date on the fax page). Each folder's `provenance.json` records the change.
- `sample_claims_mock/`: six claims written for claim types Meridian did not send (flood, third-party property damage, liability demand, Canadian residency, lapsed policy, a reused photo). Photos are reused from an earlier prototype's set and do not always match the story; the agent noticed. `SOURCES.md` records origins.
- `data/worklist.json`: 30 extract rows seeded as queue entries with no documents, routed by the structured rules only.

Every row on the screen carries its provenance.

## Run it

```
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY; optional ANTHROPIC_MODEL
npm run dev                  # http://localhost:3000
npm test                     # 72 tests, no key needed
npm run eval                 # scores the cached packets, writes eval/results/latest.json
npm run agent -- IS-CLM-2025000300   # one live run (spends money)
```

On the deployment, `/api/agent/run?claim=<id>` needs the `x-agent-run-token` header (`AGENT_RUN_TOKEN`). Background mode logs the gzipped transcript so a run can be replayed and verified locally with `scripts/decode-rec-log.ts` and `scripts/replay-run.ts`.

## Known gaps

- Page images of scanned documents reach the vision model unmasked; printed names on them are masked in the output only.
- The mock claims' photos are inconsistent with their stories, so three of their labels are provisional until matching photos exist.
- `.env.example` defaults the model to Sonnet; the cached packets were made with `claude-opus-5-5`.
- Confirmations on the deployment live in the instance's memory and clear on redeploy; production writes go through ClaimsPro's SOAP operations, which this prototype only stubs (`/api/writes`).
