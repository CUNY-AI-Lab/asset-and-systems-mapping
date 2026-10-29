// Synthetic cases only; no classroom participant data.
export const CITATION_MEMO = `Rosa meets the teacher at the school (Smith, 2025, p. 12). The teacher helps Rosa complete a referral form. Rosa carries the form to the community center. The center navigator helps Rosa compare appointment times. I interpret this as informal coordination, but I have not observed direct communication between the school and center (Lee, 2024).

References
Smith, A. (2025). Community schooling. Example Press.
Lee, B. (2024). Referral networks. Example Journal, 4, 12–18. https://doi.org/10.0000/example
`;
export const CITATION_COMPARISON_CASES = Object.freeze([
  // Exact text collected from the application's browser PDF importer using
  // tests/e2e/fixtures/memo-uploads/multi-page-citations.pdf (three pages).
  { id: 'three-page-pdf-extracted', text: `Synthetic classroom memo
Rosa meets the teacher at the school (Smith, 2025, p. 12).
Her family asks the assistant principal for help with transport.

The community center provides a place to study after school.
The assistant principal coordinates with the center (Lee, 2024).

References
Smith, A. (2025). Community schooling. Example Press.
Lee, B. (2024). Learning across settings. Synthetic Journal, 2, 1-12.`, bibliographyOnlyLabels: ['Smith', 'A. Smith', 'Lee', 'B. Lee', 'Example Press', 'Synthetic Journal', 'Community schooling', 'Learning across settings'] },
  { id: 'three-page-pdf-as-pasted-prose', text: `Synthetic classroom memo
Rosa meets the teacher at the school (Smith, 2025, p. 12). Her family asks the assistant principal for help with transport. The community center provides a place to study after school. The assistant principal coordinates with the center (Lee, 2024).

References
Smith, A. (2025). Community schooling. Example Press.
Lee, B. (2024). Learning across settings. Synthetic Journal, 2, 1-12.`, bibliographyOnlyLabels: ['Smith', 'A. Smith', 'Lee', 'B. Lee', 'Example Press', 'Synthetic Journal', 'Community schooling', 'Learning across settings'] },
  { id: 'pasted-inline-references', text: CITATION_MEMO, bibliographyOnlyLabels: ['Smith', 'A. Smith', 'Lee', 'B. Lee', 'Example Press', 'Example Journal', 'Community schooling', 'Referral networks'] },
  { id: 'narrative-author-and-citation', text: `Teacher Smith meets Rosa at the school. Smith helps Rosa complete a referral form. Rosa brings that form to the community center. My interpretation draws on a paper by a different author (Lee, 2024).

Works Cited
Lee, B. (2024). Referral networks. Example Journal.
Smith, A. (2025). Community schooling. Example Press.`, bibliographyOnlyLabels: ['Lee', 'B. Lee', 'Example Press', 'Example Journal', 'Community schooling', 'Referral networks'] },
  { id: 'late-narrative-after-references', text: `This synthetic memo records Rosa's support network. Rosa visits the school.

Bibliography
Smith, A. (2025). Community schooling. Example Press.

Appendix
At the community center, the navigator helps Rosa compare appointment times. Rosa carries a referral form from the school to the center.`, bibliographyOnlyLabels: ['Smith', 'A. Smith', 'Example Press', 'Community schooling'] },
]);
