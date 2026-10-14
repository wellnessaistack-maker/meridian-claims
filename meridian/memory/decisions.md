# Decisions log

Append-only. Add new entries at the end; do not edit or remove prior entries.

1. **(W1 Mon)** The week-2 workshop will open on a working demo rather than a deck. Laura: "show, don't tell."
2. **(W1 Tue)** Discovery prototypes use read-only ClaimsPro REST access plus the reference extract; no writes to client systems during discovery.
3. **(W1 Tue)** The 5,000-claim Snowflake extract and analytics memo provided by Michael's team (masked on policyholder fields) are the shared working dataset for discovery.
4. **(W1 Thu)** No client PII in LLM prompts during discovery, per Michael's data-handling guidance.
5. **(W1 Thu)** Both approved LLM providers are acceptable for prototyping; production provider choice is deferred to delivery.
6. **(W1 Fri)** Laura sends a Friday end-of-week email to Carlos, Sandra, and Michael for the remainder of the engagement.
7. **(W1 Fri)** The recommendation for the week-2 workshop is claim readiness and routing, not decisioning: an agent assembles a readiness packet from the three systems and recommends one of five routes, code applies the regulatory floors, the most conservative route wins, and the adjuster confirms in one click. No route can be a denial; the decision stays in ClaimsPro. Chosen over a rebuilt eligibility score (reads only amount, the 2021 failure) and intake-channel migration (Carlos's fax question; real, but not a demo). The rules alone already reach zero regulatory misses on the extract against today's 31. Pricing, rate cards and cost estimates are out of scope: the prototype shows the amount claimed against what the documents support, with sources, and nothing it invents.
