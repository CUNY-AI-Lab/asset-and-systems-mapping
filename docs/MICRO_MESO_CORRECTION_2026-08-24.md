# Micro and Meso correction — 2026-08-24

> Historical decision: the October 28 classroom update supersedes this contract. See [Current Micro/Meso workflow](MICRO_MESO_WORKFLOW_2026-10-28.md). Existing source and records remain available for provenance.

## Direct decision

The current product contract is:

- **Micro** identifies the relevant people, groups, objects, resources, and immediate settings in the memo. It also records the direct relationships among them. The verbs for those direct, within-setting relationships belong to Micro and remain at Micro throughout review, mapping, filtering, revision, and export.
- **Meso** identifies a named linkage among at least two Micro settings that include the focal person. A Meso item is a noun phrase such as **home–school coordination** or **work–college scheduling conflict**. It is not a generic relationship edge and does not carry a relationship verb.

This decision supersedes the earlier implementation rule that made Micro node-only and moved its relationships into Meso. The four-level progression remains **Micro → Meso → Exosphere → Macrosphere**.

## Why the distinction matters

Bronfenbrenner defines the microsystem through the activities, roles, and interpersonal relations a person experiences in an immediate setting. The mesosystem concerns the linkages and processes across two or more settings that include that person. In practical terms:

- A student interacts with an instructor in a course: **Micro relationship**.
- A supervisor changes a student's work schedule: **Micro relationship** within the workplace setting.
- The student's work schedule conflicts with the college course schedule: **Meso linkage** between workplace and college settings.
- A policy made in a setting the student does not participate in indirectly changes the course schedule: **Exosphere**, not Meso.

Meso therefore cannot serve as a holding area for every Micro relationship. It represents how immediate settings connect, coordinate, conflict, or otherwise meet across their boundaries.

## Application contract

### Review and suggestion data

- A Micro review may return discrete node suggestions and direct relationship suggestions.
- Every Micro relationship uses Micro endpoints, a clear verb or verb phrase, evidence, and `scale: "micro"`.
- A Meso review returns linkage candidates rather than pairwise relationship edges.
- Every Meso linkage uses `type: "mesosystem"`, `scale: "meso"`, and a noun-phrase label. The review response returns a `scope` of at least two carried Micro setting IDs; the stored candidate and graph record preserves those IDs in `scopeNodeIds`.
- A Meso review returns an empty `connections` collection. It must not generate a relationship verb, proposition, or generic actor-to-actor edge.
- Meso scope IDs may refer only to eligible carried Micro settings. People and discrete objects do not become Meso settings merely because the memo relates them.

### Student decisions and rendering

- Students may keep, revise, or remove every proposed Micro node and relationship.
- Students may keep, rename, rescope, or remove every proposed Meso linkage.
- Micro relationship labels and verbs render with the Micro records they describe.
- A Meso linkage renders in the Meso region. Lines from the linkage to its included Micro settings indicate membership in that linkage; they do not carry relationship verbs or proposition labels.
- Filtering to Micro preserves its direct relationships. Filtering to Meso shows the Meso linkages with the Micro settings needed to understand them.

### Teacher guidance

- Micro guidance may help students identify discrete elements and examine direct relationships in an immediate setting.
- Meso guidance may help students identify and name linkages among two or more carried Micro settings.
- Teacher guidance cannot redefine Micro as node-only or ask Meso to generate generic verb relationships.

### Existing projects

Previously stored Meso verb edges cannot be treated as confirmed Meso linkages. They return to Micro as research leads that require student review. The migration does not invent a Meso scope or silently confirm a reclassified relationship.

## Provenance of the correction

The Zoom summary supplied on 2026-08-21 described “micro actors / mezzo connections.” The application and its documentation elevated that shorthand into a strict rule: Micro produced nodes only, while Meso introduced generic relationship edges. The direct decision on 2026-08-24 rejects that interpretation. The earlier record remains in `docs/MARIA_ZOOM_REVERSIONING_2026-08-21.md` as historical provenance, with a superseded notice.

## Practice and theory references

- Urie Bronfenbrenner, “[Toward an Experimental Ecology of Human Development](https://doi.org/10.1037/0003-066X.32.7.513),” *American Psychologist* 32, no. 7 (1977): 513–531. A [CUNY-hosted copy](https://files.commons.gc.cuny.edu/wp-content/blogs.dir/17937/files/2021/08/Bronfenbrenner-1977.pdf) is also available.
- Urie Bronfenbrenner, “[Ecological Models of Human Development](https://www.columbia.edu/cu/psychology/courses/3615/Readings/BronfenbrennerModelofDevelopment%28short%20version%29.pdf)” (1994). This concise statement distinguishes relations within one setting from linkages across settings.
- Sam May-Varas, Jennifer Margolis, and Tanya Mead, “[Bioecological Model of Human Development](https://openoregon.pressbooks.pub/educationallearningtheories3rd/chapter/chapter-7-bioecological-model-of-human-development-2/),” *Educational Learning Theories*. The chapter summarizes a mesosystem as linkages across two or more settings that contain the developing person.
- Portland State University, “[What Is Development?](https://pdx.pressbooks.pub/humandevelopmentupdate/chapter/what-is-development/),” *Human Development*. This teaching resource applies the same Micro/Meso distinction in practice.

These sources define the analytical boundary. They do not prescribe the application's visual design or student-facing terminology beyond that boundary.
