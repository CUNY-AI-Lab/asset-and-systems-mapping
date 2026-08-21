# Maria Zoom reversioning decisions — 2026-08-21

## Source and authority

This record summarizes the Zoom material supplied for the Systems Mapping redesign on 2026-08-21. It is the implementation reference for the reversioned ecological-systems progression.

- Zoom summary: `/Users/milwright/.codex/attachments/2e3668e0-38c6-4b09-a423-54aba0e9c37e/pasted-text-1.txt`
- Ecological-systems reference images: `image-1.jpg`, `image-2.jpg`, and `image-3.jpg` in the same attachment directory
- Participants named in the supplied summary: Maria Mavrides Calderon and Zach Muhlbauer

The images are conceptual references rather than interface specifications. They consistently depict nested ecological levels: immediate settings near the person, relationships among settings, indirect institutional environments, and broader social and cultural structures. The third image is especially useful because nodes and directional relationships remain visible inside and across nested layers.

## Agreed conceptual progression

The application keeps one persistent systems map, but its four analytical levels become:

1. **Micro** — identify nodes only. Nodes may be people, roles, settings, organizations, resources, or other concrete elements named in the student's memo. The model must not generate relationships during this level.
2. **Meso** — carry Micro nodes forward and describe connections among them. This is the first level at which the model proposes relationships. Students review, edit, keep, or remove every proposed connection.
3. **Exosphere** — replace the former **Macro** level. Students organize nodes and connections within indirect institutional or environmental spheres, such as agencies, healthcare systems, schools, workplaces, funders, or decision-making bodies. Spheres are filterable map layers rather than a flat list of categories.
4. **Macrosphere** — replace the former **Integration** level. Students situate the mapped spheres within broader social, cultural, political, legal, and economic structures, including public policy, laws, racism, capitalism, and underlying beliefs. Macrosphere work may connect networks or spheres across the map.

Use the user-requested visible terms **Exosphere** and **Macrosphere** exactly. Do not silently substitute the related Bronfenbrenner labels “exosystem” or “macrosystem.” The supplied conversation did not request a separate Chronosphere level.

## Interaction and map requirements

- The progression remains permissive: students may revisit any level without an instructor approval gate.
- Micro review and extraction return nodes only. The Micro interface does not ask students to describe or review connections.
- Meso begins with the current Micro nodes already present. It adds the connection-description prompt and model-assisted relationship review.
- Exosphere and Macrosphere are visibly different from Micro and Meso. They use nested, concentric spatial regions that contain graph nodes and relationships.
- Spheres must be filterable. A student can show all available layers or isolate one level without deleting or mutating hidden graph records.
- The map must preserve readable, complete node and relationship labels. Layer graphics must not overlap text or reduce it to illegible auto-fit sizes.
- Nodes and relationships remain editable and annotatable within their sphere. Students retain final authority over model suggestions.
- Existing saved projects using `macro` and `integration` require a deterministic migration to `exosphere` and `macrosphere`; no student graph records may be discarded.
- Student project links need an optional student or group name so instructors can identify work without making that field a progression gate.

## Teacher Console requirements

- Use the same four visible level names and the same Micro/Meso generation distinction.
- Keep customization organized around the existing five workflow stages, but make part/level selection compact and avoid showing every field at once.
- Teacher guidance for Micro cannot instruct the model to propose relationships.
- Teacher guidance for Meso can shape how relationships are described and reviewed.
- Exosphere and Macrosphere guidance can shape sphere membership, cross-sphere relationships, policies, beliefs, and structural interpretation.

## Verification requirements

- Automated tests prove that Micro model output contains zero relationships.
- Automated tests prove that Meso receives the carried-forward Micro nodes and can add reviewed relationships without duplicating nodes.
- Import tests prove `macro → exosphere` and `integration → macrosphere` migration for nodes, relationships, active level, released/completed levels, configuration, and exports.
- Rendered desktop and mobile checks prove that concentric layers can be filtered, labels remain complete and legible, and hidden levels do not mutate the graph.
- A successful-cycle screenshot set includes Micro nodes, Meso connections, Exosphere spheres, Macrosphere structural layers, and relevant Teacher Console customization states.

## Separate operational follow-ups recorded in the Zoom summary

- Maria reported a broken Teacher Console password; a one-use reset-link path was implemented and separately verified.
- The active-preflight-evaluation ceiling was identified as a bug; the intended behavior is that later levels and cycles are never blocked by earlier unused review capabilities.
- The supplied summary records a Monday 4 PM preparation meeting and a Wednesday presentation. These dates explain urgency but are not hard-coded application behavior.
- A separate phishing-network discussion is outside this application redesign and is not an implementation requirement here.
