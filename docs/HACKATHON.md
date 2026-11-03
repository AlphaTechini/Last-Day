# Last Day: Hackathon Fit and Submission Checklist

**Event:** Vultr: Agent Rush Hackathon (lablab.ai x Vultr). https://lablab.ai/ai-hackathons/vultr-hackathon
**Challenge:** 2, "Powering the Future of Work". Focus area: HR & Recruitment ("coordinate onboarding, track employee workflows").
**Deadline:** 8 Nov 2026, 22:00 UTC (lablab live page). Online build 3-8 Nov.

## Brief requirements and where Last Day meets them

| Requirement (from the event page) | How Last Day meets it | Where (fill in file paths during the build) |
|---|---|---|
| Enterprise-focused AI solution coordinating multi-step agentic or rule-based workflows | Sweep, rule match, AI resolve, human approval, execute, verify, 24h re-check across 4+ systems | `src/lib/server/*` |
| A real platform or operational workflow, not a one-off demo | Employee directory, connections, runs, audit log, re-check; works on any company's systems through admin APIs | `src/routes/(app)/*` |
| Accessible through a public web browser | Public URL on Vultr with a judge login | `deploy/app/` |
| Product-style experience with clear user flows | See USER_FLOWS.md | `docs/USER_FLOWS.md` |
| Vultr VM backend and web deployment | SvelteKit + Postgres on a Vultr VM | `deploy/app/docker-compose.yml` |
| Vultr as the central backend for planning, workflows and operations (not static hosting) | Workflow engine, DB, re-check timer on Vultr; AI on Vultr Serverless Inference; Vultr account is a governed system | `docs/ARCHITECTURE.md` |
| Serverless Inference (optional for Challenge 2) | Used for the AI resolver | `src/lib/server/resolver.ts` |

## Judging criteria and how we answer each

| Criterion | Our answer |
|---|---|
| Application of Technology | AI resolver with `json_schema` output, escalation on low confidence, every call logged with model, tokens and cost. Benchmark: rules only vs rules + AI. |
| Presentation | One-click story: "Dana left. HR clicked once. Every account, even under another name, revoked and proven." |
| Business Value | Offboarding gaps at small companies (82% leave with a live account); no SCIM needed; leftover cloud spend shown in dollars. |
| Originality | Offboarding agent that proves revocation from each system's own API, and only uses AI where rules fail. |

## Submission checklist (lablab.ai form)

- [ ] Project title, short description, long description
- [ ] Technology and category tags
- [ ] Cover image
- [ ] Video presentation (see DEMO_PLAN.md)
- [ ] Slide presentation
- [ ] Public GitHub repository
- [ ] Demo application platform and application URL
- [ ] README explains the Vultr services used, the backend/deployment architecture, the use case and how the agent executes real tasks (written last, to the AI-judge README standard)
- [ ] `evidence/` populated; `.env.example` present; no secrets committed

## Open questions for the organizers (ask on lablab Discord)

1. Can one participant submit two projects, one per challenge?
2. Can online-only participants win cash prizes?
3. Must the project be built entirely during the event window?
