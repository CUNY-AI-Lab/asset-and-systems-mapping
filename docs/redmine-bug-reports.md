# System Mapping bug reports

System Mapping reuses Stem Splitter's framework-neutral bug-report form and sends reports through the authenticated Cloudflare Worker. The Worker creates private Bug issues in the CAIL Ticketing Redmine project (project 15, tracker 2).

The Redmine API key is read only from the `REDMINE_API_KEY` Worker secret. Keep it out of source files, `wrangler.jsonc` variables, browser code, and logs. The widget stays hidden until the Worker has that secret.

Each issue includes the report description, a limited page category, app release, report time, a pseudonymous CAIL account reference, and a unique report reference. The app does not attach maps, notebooks, audio, or chats, and it does not add a full page URL or session token. A reporter can still include sensitive details in the description they type. Issues are created with Redmine's `is_private` flag. The Durable Object stores only a hash of the report text, report state, issue ID, a pseudonymous account hash, and timestamps so retries can be reconciled without retaining another copy of the description.

After an ambiguous Redmine response, the Worker only looks up an issue with the same report reference; it never automatically sends another create request. Redmine does not provide an idempotency-key API. If no matching issue appears, the form keeps the report reference and description for manual follow-up. A definite rate-limit rejection can be retried; a validation or permission rejection asks the reporter to contact the Lab team.

The integration is deployed to `systems-mapping-dev` first, using `wrangler.dev.jsonc`. That Worker retains its existing isolated Durable Object namespace and CUNY identity audience. Reports use the default workspace's receipt store regardless of the selected course, with a limit of ten new reports per account in 24 hours. The browser sends a page category rather than map IDs or query parameters. The footer reserves layout space and is hidden in full-screen map and print views.

Configure the secret with `pnpm exec wrangler secret put REDMINE_API_KEY -c wrangler.dev.jsonc`, using the hidden prompt. Build and deploy with `pnpm deploy:dev` from a clean source commit. Production promotion is a separate release decision.
