---
name: BoC Valet API fallback
description: Bank of Canada Valet API quirks and fallback behavior for prime rate fetching.
---

The Bank of Canada Valet API (series V122495 for prime rate) returns "No observation for date" for dates that fall on weekends or holidays. The endpoint does not automatically return the nearest available observation.

**Why:** Weekend/holiday dates in loan start dates are common. Without handling, the API returns 404-like JSON and the prime rate endpoint fails.

**How to apply:**
- Use a hardcoded fallback (7.2% at time of writing) when the API returns no observation or any error
- Consider implementing a "find nearest previous observation" loop to improve accuracy
- Cache the result for 24 hours in memory to avoid repeated API calls
