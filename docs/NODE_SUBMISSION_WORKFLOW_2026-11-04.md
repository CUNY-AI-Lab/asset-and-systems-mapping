# Account workflow revision, November 4

This records the user's later corrections to the two-memo design. These rules
supersede the earlier two-sphere interface and five-stage student review queue
for the Cloudflare account application. The Node/Railway entrypoint remains a
separate application; its stored data and review flow are not migrated here.

1. **Micro:** upload and submit the first memo. Add the small supported starting
   set of local nodes immediately; students can rename, add or remove them.
2. **Meso:** students draw relationships between those local nodes. The model
   neither suggests nor creates relationships.
3. **Exo:** upload a distinct second memo into an empty, independent field. Use
   the existing graph as context, without copying or submitting the first memo
   as second-memo content. Classify outside decision settings at Exo and broader
   policies, values and structural conditions at Macro. Students connect Exo
   settings to selected local relationships.
4. **Macro:** students decide how broader conditions connect to mapped settings
   and relationships. Named institutions remain at Exo or Micro, according to
   the focal participants' involvement. All connections are student-created.

The map has three nested, content-sized spheres: Micro inside Exo inside Macro.
Connections use lighter lines and distinct dash patterns; the key explains
color and pattern together. Wording remains attached to its own line. Auto-fit
routes around cards and labels, separates shared paths, and gives crossings a
visible gap when they cannot be eliminated. Manual node positions persist.

The Notebook has four direct steps, persistent Back/Continue controls above the scrolling content and optional
field notes. There is no suggestion carousel, Set aside action, or hidden
review-completion prerequisite. Tools live inside the resizable sidebar. Hide
closes the sidebar; Notebook reopens it. The obsolete Map button is removed.
Evidence excerpts identify their source; node interpretation asks “Where does
this connect? What is still uncertain?” Buttons and disclosures have consistent
boundaries and states. Each node shows only Add to map or Remove according to its saved state, at the top of its editor. Removed nodes remain removed after resubmission. The report form has space around its delivery note.

Both source documents, graph identities, student relationships, notes and
placement remain saved independently. Reading an older project must not retire
an Exo node for lacking a proper name or a Macro condition for lacking a scope.
Existing relationships are preserved; this change prevents new model-created
relationships rather than deleting students' saved work.

The shared `student-nodes-v1` contract bounds output to six nodes (at most three
Exo and three Macro nodes from the second memo), requires narrative evidence,
and rejects guidance, relationships and scopes. Server, Gateway and client use
that contract. Account-interface components are isolated from legacy review
components; storage and draft journals remain shared.

Acceptance requires source regressions, Worker/browser tests, real supplied
memo tests on Dev, separate file persistence through reload, manual grouping,
desktop/phone inspection, and exact-source production package verification.
Controlled model fixtures are not evidence of live model acceptance.

Account displays verified profile details when supplied and otherwise shows CUNY Login and the verified access role, without unavailable-name/email placeholders. This changes display only, not the identity contract.

The node-submission call allows up to 8,192 completion tokens because GPT-OSS reasoning shares that limit with JSON output; a live six-page memo was cut short at 4,096. Node counts, no-relationship validation and the existing 85-second job deadline remain bounded. Legacy review calls retain their earlier limits.
