// Paired synthetic input isolates reference-list volume from narrative content.
const narrative = 'Rosa meets the teacher at the school (Smith, 2025, p. 12). The teacher helps Rosa complete a referral form.';
const appendix = 'Appendix A: Observations\nRosa brings the referral form to the navigator at the neighborhood center.';
const entries = Array.from({ length: 1800 }, (_, index) => `Researcher, A. (2025). A synthetic publication title ${index} about unrelated source metadata. Example Press.`).join('\n');
export const BIBLIOGRAPHY_COMPARISON_CASES = Object.freeze([
  { id: 'same-narrative', text: `${narrative}\n\n${appendix}`, providerNarrative: `${narrative}\n\n${appendix}` },
  { id: 'same-narrative-heavy-works-cited', text: `${narrative}\n\nWorks Cited\n${entries}\n\n${appendix}`, providerNarrative: `${narrative}\n\n${appendix}` },
]);
