# TODO

Ordered. Each item unblocks the next. Don't skip ahead.

## v0.1.0 — prove the core loop

1. **Grab the namespace.** Register `@jkershaw/yap` on npm (empty package). Create the GitHub repo with just `README.v0.1.0.md` (renamed to `README.md`), `PHILOSOPHY.md`, `DESIGN.md`. No code yet.

2. **Scaffold the package.** Node project, TypeScript, single `bin` entry (`yap`). Workspaces not needed yet — one package, clear folder boundaries (`/server`, `/web`, `/shared`).

3. **Build the in-memory state layer.** Channels, buffers, members, profiles, monotonic IDs. Pure functions where possible, no HTTP yet. Write tests for the invariants in `DESIGN.md`.

4. **Wrap it in an HTTP API.** One endpoint per tool. Plain JSON in and out. Skip MCP for now — prove the shape first with curl.

5. **Build the minimal web UI.** Single page: nick + channel form, message list, input box. Polls the HTTP API every second or two. No build step if possible — one HTML file with a small script tag.

6. **Get two humans chatting.** You and a friend in the same channel via browsers. If the feel is wrong, stop and fix it before going further.

7. **Add the MCP endpoint.** Same tools, MCP wrapper over the existing state layer. Add `/mcp-config` returning the paste-ready blob.

8. **Connect Claude Code.** Use the config from `/mcp-config`. Confirm you can `join`, `say`, `poll`, `listen` from a Claude Code session and see messages in the browser UI in real time.

9. **Polish to shippable.** `@mentions` rendered, `/me` actions, basic keyboard shortcuts, readable on mobile. Optional `YAP_PASSWORD` gate. Per-nick `say` rate limit (`YAP_RATE_LIMIT`, default 30/min). Graceful errors.

10. **Release v0.1.0.** Publish to npm. Deploy to `yap.jkershaw.com`. Tweet it if you want — or don't. It's a pet project.

## Between releases — live with it

11. **Use it for real.** A week or two. Notice what's missing, what's annoying, what you reach for that isn't there. Do not add features during this phase — just note them.

12. **Re-read `PHILOSOPHY.md`.** Cut any noted features that don't survive the re-read.

## v0.5.0 — profiles

13. **Add `/src/profiles`.** `whois(nick)` and `set_profile(description)` as defined in `DESIGN.md`. Description lives on the nick and is evicted with it. Wire into HTTP and MCP handlers alongside the existing tools.

14. **Tests.** Unit coverage for the module; integration coverage for `set_profile` then `whois` across channels; MCP conformance for both tools.

15. **Release v0.5.0.** Bump version, publish, update the hosted instance. Add the two tools to the README tool list.

## v1.0.0 — fill out the vision

16. **Reactive agent runtime.** `yap agent --config agent.json` as a new bin entry. Implements the listen-loop → LLM → say cycle. OpenRouter only to start. Test with a hand-rolled `planner.json`.

17. **CLI client.** `yap cli` as another bin entry. Terminal chat client against any server URL. Nice-to-have, not critical — skip if time-constrained.

18. **Web-based agent creator.** Form in the web UI: name, description, channels, system prompt, model. On submit, if `OPENROUTER_KEY` is set, spin up an in-process agent using the same runtime. If not, generate a downloadable `agent.json` the user can run locally with `yap agent`.

19. **BYOK OAuth flow.** OpenRouter OAuth integration for users who want to run server-hosted agents on their own credits. Optional — only enabled if `OPENROUTER_OAUTH_CLIENT_ID` is set.

20. **Abuse guards beyond per-nick rate limits.** Per-IP channel creation caps, hosted-instance defaults, and any further protections the live deployment turns out to need.

21. **Observability polish.** Read-only channel views (shareable spectate links), better rendering of system events, maybe a small "who's here" sidebar.

22. **Release v1.0.0.** Update the README. Tag the release. Write a short blog post if the mood strikes.

## Never

- Anything in the "Things we will not add" list in `PHILOSOPHY.md`.
- Features added because they'd be easy, rather than because they'd be used.
- Abstractions introduced before the second concrete use case exists.
