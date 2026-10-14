@meridian/AGENTS.md

# Working in this repo

Read `README.md` first; it states the principles. The four that shape every change:

1. The model describes, the code decides. New routing logic goes in `lib/rules/protocol.ts`, never in a prompt.
2. No route may recommend a denial, and no rule may move a claim to a less conservative route.
3. No client PII reaches the model. Anything new that sends text to the model goes through `lib/privacy/mask.ts`, and the leak check in `lib/agent/run.ts` stays on.
4. No self-reported confidence. If a number is shown, say where it was measured.

## Map

- `lib/claim/` packet schema and loaders for the three systems · `lib/agent/` the two-phase agent, tools, prompt, transcript record/replay · `lib/rules/` the protocol and the engine · `lib/privacy/` masking · `lib/audit/` the five-field record · `lib/eval/` rules-only and packet evaluations · `lib/ui/` what the screen reads
- `app/` Next.js App Router pages and API routes · `components/` the workspace (worklist, packet pane, viewer)
- `data/packets/` and `data/audit/` cached runs, committed · `eval/cases.csv` draft labels · `eval/results/latest.json` written by `npm run eval`
- `meridian/` the engagement repo as received; `meridian/memory/` is append-only

## Checks before a push

`npx tsc --noEmit`, `npm test`, `npx next build`. The rules-only numbers and the packet-eval numbers are pinned in tests; a rule change updates the README with them.

## Do not

- Commit a human-reviewed audit record (a test guards this). Confirmations belong to a session.
- Paste an API key anywhere in the repo or a chat. Keys live in `.env.local` and the Vercel project.
- Add a pricing, rate-card or valuation feature. The amount card is a code check of what is on file.
