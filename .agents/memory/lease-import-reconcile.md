---
name: Lease import server-side math reconcile
description: PDF lease import recomputes per-square-foot money math server-side; per-sf rates are source of truth
---

Rule: never trust LLM arithmetic on lease imports. When rentable square feet and per-square-foot annual rates are available, recompute monthly amounts server-side (rent steps, first-year monthlyPayment, CAM monthly) and overwrite the model's numbers — including non-null values the model returned.

**Why:** the extraction model returned $3,383.33 instead of $3,391.67 for a $37/sf step ($37×1,100÷12); small math slips would flow straight into schedules and disclosures.

**How to apply:** `reconcileLeaseMath()` in the api-server extraction lib, called in the imports route right after extraction. If new per-sf fields are added to the extraction schema, add them to the reconcile pass. CAM and percentage rent are executory/contingent costs — kept out of minimum lease payments and straight-line math; percentage rent is only preserved as a description note.

Related: operating-lease total commitment (`principal`) must come from the straight-line schedule total (steps + free rent aware), not monthlyPayment×termMonths — both the create flow and the re-evaluate flow.
