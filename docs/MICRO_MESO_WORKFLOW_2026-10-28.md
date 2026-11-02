# Micro and Meso workflow — October 28, 2026

## Current product decision

The October 28 implementation request, based on the supplied meeting summary, supersedes the August 24 Micro/Meso correction for classroom workflow. Students build one map through the existing five stages and four levels.

- **Micro** identifies the people, groups, roles, activities, objects, resources, and immediate settings in the memo. Students arrange these as nodes around the focal person and attach evidence.
- **Meso** adds relationships between those same Micro nodes. Students select a first node and a second node, name the relationship, record evidence, and choose a one-way or two-way arrow. The Micro node IDs and positions remain stable. Meso shares the Micro map space.
- **Exo** identifies outside decision settings and supported funding or decision paths between them or into immediate settings.
- **Macro** continues to identify broader conditions and the map items they affect.

Meso represents relationships rather than a second concentric region. A relationship may join people, groups, resources, or settings already present in Micro. Students decide which suggestions to add and may also make supported connections manually.

## Review and storage contract

A Micro memo review returns up to ten node suggestions and an empty connections array. A Meso memo review returns an empty nodes array and up to eight relationship suggestions. Each Meso relationship uses two different exact IDs from the carried Micro nodes, plus a verb and evidence rationale. Complete reviews remain atomic, with bounded correction and citation-aware source checks described in `CITATION_GUIDANCE_RECOVERY_2026-10-28.md`. If an individual suggestion still fails after those attempts, a clearly labeled feedback-only review may retain independently validated guidance with no map suggestions. This does not claim that a missing Meso relationship was preserved.

Graph relationships use `scale: "meso"`. The existing `relationshipProcess.direction` records `source to target`, `target to source`, or `both directions`; the canvas and exported map render that direction. Exo also permits a named outside office to connect to another outside office, preserving intermediate funding and decision steps. Macro retains scoped conditions.

Schema version 8 moves saved Micro relationship records into Meso while preserving their IDs, statuses, evidence, notes, annotations, authorship decisions, and direction. It releases Meso when needed to keep those saved relationships accessible while retaining the active level. Version 7 Field Notes and level progress stay intact. Existing scoped Meso records remain readable for continuity, and new Meso work uses relationships. A current-format file also accepts earlier Micro relationship records for compatibility; fresh student and model actions create Meso relationships.

Only outdated guidance is refreshed. Existing graph and candidate records remain available. Every import and private backup still passes bounded project validation. Shared exports keep their audience and redaction rules. They preserve canonical arrow directions and explicit direction uncertainty. Restricted exports replace private direction prose with “not yet known” and clear other protected process details. Model suggestions preserve a supplied canonical direction and otherwise begin with a source-to-target arrow; students can change it on the map.

## Verification

The contract tests cover node-only Micro review; Meso requests carrying people, resources, and settings; exact endpoint IDs; unknown endpoint rejection and one corrective retry; stale scoped-node review rejection; duplicate relationship prevention; and preservation of version 7 student work across import and export. Canvas interaction and Studio preview checks are recorded with the task's implementation checklist.


## Current assignment details

The EDUC 210 assignment retrieved October 28 specifies connection strength, communication channel, who does the connecting work, dependent-family counts, and explicitly missing pairs. Relationships therefore have optional `relationshipProcess` fields: `strength` (`strong`, `weak`, `contested`, `unknown`), `channel`, `connectingWork`, `familyCount` (nonnegative integer or null), and `connectionStatus` (`observed`, `missing`, `unknown`). Existing frequency, duration, direction, conditions, and change-over-time fields remain available.

Model details require explicit source support. Counts of children and percentages remain in evidence, with no conversion into family counts. Missing pairs require quoted absence evidence and retain their status through private storage, List, and map export. Restricted exports preserve direction and missing-pair status while redacting private prose, strength, and counts. Explicit unknown or varying direction remains unknown or varying after redaction. Earlier saved process objects remain valid without the new fields.
