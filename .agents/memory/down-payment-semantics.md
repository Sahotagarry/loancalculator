---
name: Down payment semantics
description: How downPayment interacts with principal across schedules, FV, exports
---

Rule: `principal` is always the face/total amount; the financed amount actually amortized is `principal − downPayment`. All schedules, FV day-one discounts, continuity, loan proceeds, and balance fallbacks use the financed amount; display cards/headers/descriptions keep face principal.

**Why:** Chosen so existing loans (downPayment=0) are unaffected and users see the contract amount while math reflects cash actually borrowed.

**How to apply:** Any new computation touching loan principal must net out `downPayment` (numeric string, default "0"). Server rejects downPayment < 0 or >= principal on create/PATCH.
