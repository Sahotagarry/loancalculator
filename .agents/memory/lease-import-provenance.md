---
name: Lease import provenance & estimates
description: PDF lease extraction returns fieldNotes + estimates; wizard must keep facts vs AI estimates visually distinct
---

The lease extraction contract has two provenance channels: `fieldNotes` (field → short citation of where in the document the value came from; only for non-null extracted fields, never for inferred-false booleans) and `estimates` ({economicLifeYears, fairValue, interestRate, reasoning}) for values NOT stated in the document.

**Why:** The user is an accountant who must verify classification inputs; extracted facts and AI guesses must never be conflated. Estimates must never be written into the main lease fields by the extractor — they are opt-in via a "Use estimate" button in the wizard (amber card), while document facts get blue "From the document" chips mapped per criterion.

**How to apply:** Any new extractable lease field should get a fieldNotes citation in the prompt; any new "AI helps you guess" value belongs in estimates with reasoning, surfaced as a clearly-labelled suggestion, never a prefill.
