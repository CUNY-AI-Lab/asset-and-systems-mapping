# Guidance latency verification

## Boundaries

Changes are isolated to Systems Mapping. No Gateway, Railway, identity-service,
database namespace, or schema deployment is included. The candidate preserves
the published account/draft fixes through `7f60d1b`.

## Findings

- Valid GLM responses carried the native model ID
  `@cf/zai-org/glm-5.3-flash`. The shared OpenRouter parser rejected that ID.
  Normalize only an exact canonical/native match in the Cloudflare adapter;
  leave the Railway parser unchanged.
- GLM completed compact, schema-validated memo reviews in approximately
  12.5–18.3 seconds after this correction.
- GPT-OSS 20B completed the same review in 6.2 and 7.9 seconds. A controlled
  primary refusal followed by a real GPT-OSS call completed in 5.0 seconds.
  One separate GPT-OSS response failed semantic validation and returned 502;
  this is a remaining model-quality limitation, not a successful generation.
- DeepSeek Flash completed a minimal JSON probe, but repeatedly exceeded the
  25-second full-memo budget with both low and disabled reasoning. It is not
  configured as the automatic backup.

These paid checks used the actual Gateway with a temporary application key and
the local product's complete request/validation/persistence path. They did not
exercise production browser SSO. The refusal in the fallback check was
controlled locally; the backup inference was real. They establish individual
observations, not a percentile SLA or a guarantee of warm provider residency.

## Behavior

- Browser waiting ends at 30 seconds, including response-body parsing
- Worker waiting ends at 28 seconds, including identity and course dispatch
- Model attempts and fallback share one 25-second budget
- Known retryable availability refusals may select GPT-OSS through a new
  admitted Gateway call; quota, auth, timeout, ambiguous errors, partial or
  invalid completed responses do not automatically repeat inference
- Failure displays a persistent `Couldn’t generate guidance — Try again`
  message and an actionable retry button; quota exhaustion is identified
  separately
- An absolute deadline crosses the course RPC boundary; the reconstructed
  local signal releases the permit and prevents late persistence
- Existing memo and map data are preserved
- Session affinity is Gateway-scoped; no speculative warm-up inference runs

## Local verification

- Full suite with Chrome account acceptance: 660 passed, 4 skipped
- Worker typecheck, Cloudflare frontend build, and Worker dry-run bundle passed
- Real Workers/SQLite cancellation test: expired generation returns promptly,
  immediate retry succeeds, and the late first answer never enters storage
- Availability fallback integration test: exactly two admitted binding calls,
  with the answering canonical model recorded
- Browser/UI tests: persistent alert, retry, unchanged memo, duplicate-click
  protection, and ignored late responses

The live acceptance test is opt-in via `SYSTEMS_MAPPING_LIVE_GUIDANCE=1` and
requires the owning Gateway's unmodified loopback acceptance helper. DeepSeek
probes require additional explicit environment flags. Temporary credentials
are revoked by the harness; two early diagnostic credentials whose cleanup
request failed had a fixed ten-minute expiry, which elapsed during this run.

No claim of signed-in production acceptance follows from these local checks.
