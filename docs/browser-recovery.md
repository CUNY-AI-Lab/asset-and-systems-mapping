# Retired browser transfer interface

The cross-address browser-copy interface has been removed. URLs containing the
old `browserRecovery` query parameter now open the ordinary app; the parameter is
removed before React renders, while unrelated query parameters and fragments are
preserved. The app shows no recovery screen, status, link, banner, or prompt.

Loading an old URL does not clear or rewrite browser storage, local archives,
private maps, or open drafts. Existing account and project APIs retain their
normal signed-in identity and ownership checks. The retired transfer proof API is
no longer available.
