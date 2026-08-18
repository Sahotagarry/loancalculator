---
name: FV rate validity rule
description: What counts as a usable fair-value rate and why every consumer must guard it
---

A fair-value rate is usable only when it is a finite number strictly > 0. Zero, negative, NaN, and Infinity all corrupt PV discounting — and `rate <= 0` checks let NaN through, so `Number.isFinite` is mandatory.

**Why:** A malformed persisted rate would otherwise silently corrupt booked schedules, workpapers, and exports; client-only input validation is insufficient because rates also arrive via general loan PATCHes and legacy DB values.

**How to apply:** use the shared validity helper exported by the amortization lib everywhere a rate is resolved or a schedule is built; API routes reject invalid rates with 400; when no valid rate exists, fall back to the contractual schedule (or omit fvRate from the write) rather than persisting/using 0.
