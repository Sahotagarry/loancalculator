---
name: Security clause / collateral NBV coupling
description: Specific-charge clauses and the collateral asset must stay in sync — pledged assets require NBV disclosure
---

Rule: If a loan's disclosure names a specific charge on equipment or real property, the pledged asset's net book value MUST be disclosed (ASPE 3856). Naming pledged assets without NBV is a disclosure deficiency per the user.

**Why:** User (an accountant) confirmed this explicitly; drove the design where specific-charge checkboxes and the Collateral Asset section are coupled rather than independent.

**How to apply:**
- Selecting a collateral asset type auto-checks the matching specific-charge clause (equipment → equipment clause; building/land/land_and_building → real property clause). User can still uncheck.
- Diagnostics warn (`charge-equip-no-nbv`, `charge-realprop-no-nbv`) when a specific-charge clause is checked but no matching collateral asset type is set.
- Do not reintroduce a separate asset-tracking section for loans; the Collateral Asset section is the single source for a loan's pledged asset. Capital leases keep their own Leased Asset section (it's the leased asset, not collateral).
