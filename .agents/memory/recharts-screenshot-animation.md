---
name: Recharts screenshot animation truncation
description: Why Area/Line charts look cut off in screenshots and how to fix
---

Recharts Area/Line series animate on mount by drawing left-to-right (~1.5s). A screenshot taken during that window captures the curve only partially rendered (e.g. ~60% width), which looks exactly like a data-truncation bug. Bars animate by growing vertically, so they appear full-width immediately and hide the problem.

**Why:** Wasted multiple debugging cycles chasing a "truncated data" bug that was purely an animation artifact — the underlying schedule data was complete.

**How to apply:** Before concluding a chart is truncated, verify the data length independently. For data/reporting tools, set `isAnimationActive={false}` on Area/Line/Bar — deterministic screenshots and instant render are preferable to the draw animation.
