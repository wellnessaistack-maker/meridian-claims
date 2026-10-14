# Meridian claim readiness

A working prototype for the week-2 workshop with Meridian.

**Live demo:** https://meridian-claims-sigma.vercel.app

## What it does

An adjuster at Meridian starts the day with a queue of commercial auto claims. Today, every claim means opening about seven ClaimsPro screens, reading the fax, the estimate, the photos and the notes, and working out by gut what to do first.

This prototype does the reading. For each claim, an AI agent pulls together everything on file from the three systems (ClaimsPro, Snowflake and Databricks), writes up a one-page "readiness packet", and recommends what should happen next. The adjuster sees the packet, the reasons, and the evidence behind every line, and confirms the route with one click.

The AI never decides a claim. It never approves, never denies, never pays. The decision is still made by a person in ClaimsPro, exactly as it is today.

## How a claim moves through it

1. **The agent reads.** It opens the claim across the three systems and the documents attached to it. Names, phone numbers and other personal details are masked before anything reaches the model.
2. **The agent describes.** It fills in a fixed form: the key facts and where each came from, a timeline, places where the sources disagree, anything that looks like a reason a claim might be denied, and anything missing. Then it recommends one of five routes.
3. **The rules decide.** A set of plain-code rules checks the packet against Meridian's regulatory floor: human review over $10,000 in the twelve threshold states, consent states, Canadian residency, a lapsed policy, any denial indicator. A rule can only push a claim toward more review, never less. The most cautious answer wins.
4. **A person confirms.** The adjuster confirms the route, or changes it and says why. Every change is recorded and becomes a test case for the next version.

### The five routes

| Route | What it means |
|---|---|
| **Ready to decide** | Everything is on file, nothing disagrees, the amount is under the simple-claim ceiling. The adjuster can decide now. |
| **Request information** | Something is missing from the claimant or the repair shop. A request is drafted and sent; the claim waits until it comes back. |
| **Verify documents** | A document or a field needs a person's eyes before the claim can be decided (for example, a faxed estimate the OCR read badly). |
| **Specialist review** | A senior adjuster should look: the amount is over the ceiling, or two sources disagree on something that matters. |
| **Full review** | A person adjudicates in full and writes it up: a regulatory threshold applies, or there is a possible reason for denial. |

Claims for Canadian policyholders are never sent to the model at all, because of the data-residency constraint. They are marked out of scope by the rules and handled by a person.

## The rules behind the routing

There are two kinds of rule, and the Routing protocol page in the app shows the same file the code runs.

- **Locked rules** come from regulation and Meridian's compliance floor. Changing one is a new protocol version with compliance sign-off. These cover the $10,000 threshold states, the consent states, Canadian residency, a policy that had lapsed on the date of loss, and any denial indicator in the packet.
- **Operating settings** are Meridian's own dials, with safe limits: the simple-claim ceiling (currently $5,000), how complete the evidence must be, how weak an OCR reading can be before a person checks it, and how to treat disagreements between sources.

## Does it work? The numbers so far

### The rules alone, on Meridian's own extract

Meridian sent an extract of 5,000 closed claims. Five hundred of them carry a label saying whether a human review was actually needed. We ran the structured rules (state, amount, regulatory flag) over all 5,000 and compared them with the flag ClaimsPro raises today.

| | Claims flagged (of 5,000) | Needed review but not flagged | Flagged but did not need it | Regulatory cases missed |
|---|---|---|---|---|
| ClaimsPro's flag today | 2,280 | 21 of 159 | 63 | **31 of 134** |
| This protocol, default settings | 2,513 | 34 | 71 | **0** |
| Regulatory floor only | 1,272 | 88 | 0 | 0 |

The headline: today's flag misses 31 claims where the law requires a person. The protocol misses none, by construction. It flags slightly more claims overall, which is the price of that guarantee; the ceiling is a dial Meridian can turn.

One caveat. The "needed review" label is set after the claim closes, so it knows how complex the claim turned out to be. A rule running at intake cannot know that. These numbers are a floor, not a forecast.

### The full agent, on labelled test claims

Sixteen claims have a hand-written label saying what the right route is. Fifteen have been through the agent for real; the Canadian one is rules-only by design. Results:

- Every claim that had to reach a person did: **10 of 10**.
- The route matched the label exactly on **12 of 16**, and was within the acceptable range on **16 of 16**.
- No claim was escalated that did not need to be: **0 of 6**.
- The faxed estimate line that the OCR read as `1,B00` was re-read as `1,800.00`, on both the garbled copy and the clean one.

The four that did not match exactly are three mock claims whose stock photos do not match their stories (the agent noticed and escalated) and one variant where a contradiction outranked a missing document. All four landed on a more cautious route, not a less cautious one.

These labels were written by one person. Before any of these numbers goes on a slide, two adjusters should label the same cases independently and resolve the disagreements.

## Where the claims on screen come from

Every row in the app says which of these it is.

- **Meridian sample claims.** The three real claims Meridian provided, plus the 5,000-row extract. These are the base. Thirty extract rows also appear in the queue as claims with no documents, routed by the structured rules alone.
- **Variants.** The sample claims with one thing changed by a script: the estimate removed, the amount nudged over $10,000, the state changed to Texas with the consent flag blank, a clean copy of the garbled fax, a date repainted on the fax image. Each variant records what was changed and from which parent.
- **Mock claims.** Six claims written from scratch to cover situations Meridian's three samples do not: a flood, third-party property damage, a liability demand letter, a Canadian policyholder, a lapsed policy, and a photo reused from a closed claim. Their photos are borrowed from an earlier prototype and do not always match the story. The agent flagged the mismatches, which is reassuring about the agent and embarrassing about the photos.

## What the demo shows

- **Play the morning.** The inbox starts empty and the claims arrive one at a time, oldest first, each assessed and sorted into its group as it lands. This replays the real model runs that are saved in the repo, so it needs no API key and costs nothing.
- **The amount.** What was claimed, against the totals actually on file in the documents, each with its source. This is a code check of the paperwork, not a valuation. There is no rate card and the model never estimates a price.
- **How this route was decided.** For each claim: what was read, which tools the agent called, what it recommended, which rules fired, and why the final route is what it is.
- **The audit record.** The five fields the compliance floor asks for (input, model version, output, confidence, human reviewed), plus the written rationale and the full history. Downloadable, printable.
- **Ask and wait.** Confirming a "request information" claim sends the drafted request and moves the claim to Waiting. In the demo, a prefilled reply from the claimant can be received with one click; the claim comes back to the inbox to be re-checked. In production the reply would be a ClaimsPro document event.

## Running it yourself

```
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # open http://localhost:3000
npm test                     # 72 tests, no key needed
npm run eval                 # re-scores the saved runs against the labels
npm run agent -- IS-CLM-2025000300   # one live run of the agent (costs money)
```

Without a key, the app shows the saved runs and says so; re-running is disabled. It never pretends to call the model.

On the hosted version, re-running a claim needs a token, so nobody can spend Meridian's API budget by guessing a URL.

## Design principles

- **The model describes, the code decides.** The AI's job is to read and write up. Routing logic lives in code that a compliance officer can read.
- **The AI never recommends a denial.** That word is not in its vocabulary. Possible reasons for denial are surfaced, with evidence, for a person.
- **No self-reported confidence.** The confidence numbers on the audit record are measured: OCR confidence and re-reads, evidence completeness, and how often the route matched the label in evaluation.
- **No personal data in prompts.** Names, phone numbers, emails, dates of birth and addresses are masked before the model sees them, and a check stops any run that would echo a name back.
- **Never fail silently.** If something could not be read or could not be run, the screen says so.
- **Every correction is a test case.** When an adjuster changes a route, the reason is recorded and feeds the next evaluation.

## Honest limitations

- Scanned page images reach the vision model as pictures, so a printed name on a fax is not masked on the way in. It is masked on the way out. Production needs image redaction.
- Three of the mock claims have photos that do not match their stories, so their labels are provisional.
- Thirteen of the saved runs used prompt version 2 and three used version 3 (which adds one line: a missing document is a gap, not a contradiction). Both are recorded on each run.
- The default model in `.env.example` is Sonnet; the saved runs used Opus.
- Confirmations on the hosted demo live in memory and clear when it is redeployed. Writing back to ClaimsPro is stubbed; nothing leaves the building.

## Where things are

- `lib/agent/` the agent and its tools · `lib/rules/` the routing protocol and engine · `lib/privacy/` masking · `lib/audit/` the audit record · `lib/eval/` the evaluations
- `components/` the screen · `app/` pages and API routes
- `data/packets/` and `data/audit/` the saved runs · `eval/cases.csv` the labels · `eval/results/latest.json` the latest scores
- `meridian/` the engagement repo as received, including the sample claims and the extract
