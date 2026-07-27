---
name: Clearline Modern Fintech theme
description: App-wide design direction approved by the user in July 2026
---

The user approved the "Modern Fintech" design direction app-wide for the loan calculator.

**The rule:** All pages use a dark charcoal (#262626) header band with the white/orange Clearline logo variant; brand orange is #FB7708 (hsl 27 96% 51%) for primary/ring in BOTH :root and .dark token blocks (they must stay in sync — PageHeader forces the `dark` class, so stale .dark tokens leak into every header). Fonts: Lato (body/sans) + Raleway (display/headings), loaded via Google Fonts in index.html.

**Why:** User explicitly chose Modern Fintech over Refined Professional and asked to "keep the black header everywhere" to match clearlinecpa.ca branding (charcoal stat band, orange accents, Lato/Raleway).

**How to apply:** New pages must use the shared PageHeader (which carries the dark band). Don't reintroduce Inter/Space Grotesk. The dark-header logo asset is attached_assets/clearline-logo-white.png (gray wordmark recolored white, orange preserved); the original gray logo is illegible on the dark band — never put it on a white chip in the header.
