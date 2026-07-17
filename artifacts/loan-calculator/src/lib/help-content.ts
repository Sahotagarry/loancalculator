export interface HelpTopic {
  id: string;
  title: string;
  screen: string;
  keywords: string[];
  body: string[];
  related: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "overview",
    title: "App Overview",
    screen: "All screens",
    keywords: ["overview", "about", "getting started", "introduction", "aspe", "clearline", "workflow"],
    body: [
      "This application is one of Clearline's engagement tools. It builds ASPE-compliant loan and lease amortization tables, year-end schedules, and note disclosures for Canadian private enterprise engagements.",
      "The app is organized in three levels: Clients hold Year-End Files, and each Year-End File (one per fiscal year end) holds the loans, capital leases, and operating leases outstanding in that year.",
      "Typical workflow: add a client, create a year-end file for the fiscal year end you are auditing or reviewing, add each loan and lease, then review the generated schedules, classifications, disclosures, and diagnostics before exporting workpapers.",
      "Everything is recalculated on the fly from the loan terms you enter, so editing a loan immediately updates its schedule, disclosures, and journal entries.",
    ],
    related: ["clients-files", "loans-leases", "workpapers-exports"],
  },
  {
    id: "clients-files",
    title: "Clients & Year-End Files",
    screen: "Home and Client pages",
    keywords: ["client", "add client", "edit client", "code", "year-end file", "fiscal year end", "fye", "roll forward", "file", "materiality", "trivial threshold"],
    body: [
      "The Home screen lists your clients. Each client has a name and a short unique code, and shows how many year-end files and loans it holds.",
      "Opening a client shows its Year-End Files. A year-end file represents one fiscal year end engagement (e.g. December 31, 2025) and is the container for all loans and leases outstanding in that year.",
      "Each year-end file can carry a trivial threshold and a materiality amount. These drive the fair value decision guidance (ASPE 3856) and the review checklist findings.",
      "Roll forward creates the next year's file in one click: it copies all outstanding loans and leases to a new file with the next fiscal year end, so you don't re-enter them every year. Matured loans are carried over so comparatives stay complete.",
      "Deleting a client or a year-end file permanently removes everything inside it, so use those actions carefully.",
    ],
    related: ["overview", "loans-leases", "review-checklist"],
  },
  {
    id: "loans-leases",
    title: "Loans & Capital Leases",
    screen: "Year-End File and Loan Detail pages",
    keywords: ["loan", "capital lease", "operating lease", "add loan", "principal", "interest rate", "term", "amortization period", "balloon", "interest-only", "payment frequency", "counterparty", "security", "collateral"],
    body: [
      "From a year-end file, the 'Add Loan or Lease' button offers three ways to add an item: Import from PDF (AI reads the signed agreement and prefills the right form — works for loans and leases), Add Loan (enter loan terms directly), and Add Lease (a guided assessment that classifies the lease as capital or operating under ASPE 3065).",
      "Three kinds of items result: loans, capital leases, and operating leases. Loans and capital leases produce amortization schedules; operating leases are straight-lined under ASPE 3065.",
      "For a loan you enter the principal, interest rate, amortization period, term, start date, and payment frequency (monthly, semi-monthly, bi-weekly, or weekly). Optional inputs include a down payment, interest-only months, a balloon payment, a payment override, and security/collateral details.",
      "Capital leases are created through the Add Lease assessment (not the loan form). They capture the same payment mechanics as loans plus the ASPE 3065 classification criteria and the leased asset's cost and useful life, so the app can build both the lease liability schedule and the asset depreciation schedule.",
      "Status badges on each item flag things like maturity within 12 months (fully current), balloon payments coming due, active interest-only periods, expired leases, and covenant violations (shown in red).",
      "Opening any item shows its full schedule, annual fiscal-year totals, charts, journal entries, disclosures, and a per-item review checklist.",
    ],
    related: ["down-payments", "amortization-schedules", "lease-classification", "fair-value", "covenant-violations"],
  },
  {
    id: "covenant-violations",
    title: "Covenant Violations (ASPE 1510)",
    screen: "Loan forms, Year-End File, and Presentation & Disclosure",
    keywords: ["covenant", "violation", "breach", "callable", "demand", "reclassify", "current", "aspe 1510", "waiver", "default"],
    body: [
      "When a borrower violates a financial covenant (for example a debt-service or working-capital ratio), the lender typically gains the right to demand repayment. Under ASPE 1510, callable debt must be classified as a current liability even if scheduled payments extend beyond one year.",
      "Mark a violation with the 'Financial covenant violation' checkbox on the loan or capital lease form. The toggle applies only to debt items — operating leases have no covenant checkbox.",
      "When flagged, the entire outstanding balance is reclassified to the current portion (long-term shows nil), and a red 'Covenant Violation' badge appears on the item. All totals, summary tables, and stat cards update automatically.",
      "The Presentation & Disclosure tab splits the current portion into 'scheduled repayments due within one year' and 'scheduled repayments due beyond one year, callable on covenant violation', and adds a covenant violation note under the Long Term Debt and Capital Lease disclosures.",
      "Workpaper exports carry the same treatment: the lead sheet flags violated items and shows the within/beyond-one-year breakdown, and each item's workpaper includes the reclassification with an ASPE 1510 note.",
      "If the lender formally waives the violation before the balance sheet date such that the debt is no longer callable, normal classification may be appropriate — in that case leave the checkbox off and document the waiver in your file.",
    ],
    related: ["loans-leases", "amortization-schedules", "workpapers-exports"],
  },
  {
    id: "down-payments",
    title: "Down Payments",
    screen: "Loan forms and Loan Detail page",
    keywords: ["down payment", "deposit", "financed amount", "face amount", "principal"],
    body: [
      "When a loan includes a down payment, enter the full face amount as the principal and the down payment separately.",
      "All calculations — payments, interest, schedules, and disclosures — run on the financed amount (principal minus down payment), while the loan still displays its face amount so it ties to the loan agreement.",
      "This means the opening balance of the amortization schedule equals the financed amount, not the face amount, which is the correct basis for interest accrual.",
    ],
    related: ["loans-leases", "amortization-schedules"],
  },
  {
    id: "amortization-schedules",
    title: "Amortization Schedules",
    screen: "Loan Detail page",
    keywords: ["schedule", "amortization", "payment", "principal", "interest", "balance", "annual", "fiscal year totals", "chart", "current portion", "long-term", "balloon", "maturity"],
    body: [
      "The Schedule tab shows every payment period with its payment amount, principal and interest split, cumulative interest, and remaining balance. Rows at each fiscal year end are emphasized so year-end balances are easy to pick out.",
      "The Annual view aggregates the schedule into fiscal years based on the file's year end, giving the principal and interest for each 'Year ending' — the figures you carry into the financial statements.",
      "The schedule runs to the end of the loan term. If the term is shorter than the amortization period, the balance remaining at term end is an implicit balloon: it is not part of any scheduled principal payment, and the disclosures add it to the maturity year automatically.",
      "Interest-only months, specific interest-only periods, balloon payments, payment overrides, and all four payment frequencies are supported and reflected in both the schedule and the annual totals.",
      "Charts visualize the declining balance and the annual principal/interest mix.",
    ],
    related: ["loans-leases", "down-payments", "fair-value", "workpapers-exports"],
  },
  {
    id: "fair-value",
    title: "Fair Value (ASPE 3856)",
    screen: "Loan Detail page — Fair Value tab",
    keywords: ["fair value", "aspe 3856", "below market", "market rate", "prime rate", "discount", "effective interest", "trivial", "immaterial", "adjusting entry", "related party", "day one"],
    body: [
      "Loans bearing interest below market rates (the app flags rates of 3% or lower) may need to be measured at fair value under ASPE 3856 by discounting the contractual payments at a market rate.",
      "The app suggests a market rate based on the Bank of Canada prime rate at the loan's start date; you can override it with your own fair value rate.",
      "You then record a decision on each flagged loan: use fair value, treat the difference as trivial (below the file's trivial threshold), or immaterial (below materiality). The decision and your note are kept as audit evidence.",
      "When fair value is adopted, the booked schedule uses the effective-interest method: contractual payments stay fixed, but interest accrues at the market rate on the discounted carrying amount. The contractual schedule remains available on a comparison tab.",
      "For each fiscal year the app also builds the cumulative unrecorded adjusting entry — the catch-up needed if the client keeps the loan at face value — split between opening retained earnings and current-year interest.",
    ],
    related: ["amortization-schedules", "loans-leases", "review-checklist"],
  },
  {
    id: "lease-classification",
    title: "Lease Classification (ASPE 3065)",
    screen: "Year-End File page — lease assessment",
    keywords: ["lease", "classification", "aspe 3065", "capital", "operating", "transfer of ownership", "bargain purchase option", "75%", "90%", "economic life", "present value", "straight-line", "free rent", "escalation", "inducement", "tenant improvement", "rent steps", "stepped rent", "rent schedule", "square feet", "office", "shortcut", "fast track", "property lease", "industrial building"],
    body: [
      "When you add a lease, the guided assessment walks through the ASPE 3065 criteria: transfer of ownership, a bargain purchase option, lease term covering substantially all (≈75%+) of the asset's economic life, and present value of minimum lease payments substantially all (≈90%+) of the asset's fair value, plus whether the asset is specialized.",
      "Property Lease Shortcut: the first screen of the assessment asks what kind of asset is being leased. If you pick Office/Commercial or Industrial Building, a shortcut appears — confirm three things (the lease does not transfer ownership and has no bargain purchase option; the space is standard, not specialized or purpose-built; and total rent is well below what buying the property would cost), enter the lease term and starting monthly rent, and conclude Operating Lease without walking through all five criteria. Typical property leases qualify because a building's ~40-year useful life means the term is far below the 75% test and market rent rarely approaches 90% of the building's value — but if any confirmation doesn't hold, or the term reaches 75% of the useful life (the shortcut locks itself in that case), run the full assessment instead.",
      "If any criterion is met, the lease is classified as a capital lease: the app records the leased asset and lease obligation and builds the liability amortization and asset depreciation schedules. Your rationale is saved with the lease.",
      "If no criterion is met, the lease is an operating lease. Rent is straight-lined over the lease term, including free-rent months and rent escalations, producing a deferred rent balance each year.",
      "Lease inducements (tenant improvement allowances and other inducements) are amortized against rent expense over the term. You can record whether the inducement was received in cash, which drives the cash flow disclosure.",
      "Office property leases have extra fields for the straight-line inputs (free rent, escalation rate, inducements).",
      "Commercial office leases often quote rent in steps — fixed dollar amounts that increase by lease year (e.g. years 1–2 at one rate, years 3–5 higher). Enter these in the rent schedule editor: each step covers a range of lease years with its monthly rent. When a rent schedule is entered, it takes priority over the escalation percentage, and the straight-line expense averages the actual stepped payments over the term.",
      "The future lease commitment disclosures and total commitment use the actual stepped amounts for each fiscal year, with free-rent months counted as zero cash rent.",
    ],
    related: ["loans-leases", "pdf-import", "amortization-schedules", "workpapers-exports"],
  },
  {
    id: "pdf-import",
    title: "Import from PDF",
    screen: "Year-End File page — Add Loan or Lease menu",
    keywords: ["import", "pdf", "upload", "document", "agreement", "extract", "prefill", "scan", "read", "ocr", "azure"],
    body: [
      "Instead of typing loan or lease terms by hand, choose 'Import from PDF' from the Add Loan or Lease menu and upload the signed agreement — the app reads it for you. It classifies the document as a loan or a lease (capital or operating) and extracts the key terms: names, dates, amounts, rates, term, payment frequency, and more.",
      "For commercial office leases it also picks up the rentable square footage, converts per-square-foot annual rates into monthly rent, builds the stepped rent schedule by lease year, and extracts the tenant improvement allowance and any free-rent period.",
      "You always review before saving: the extracted fields are shown with a confidence level and the reasoning behind the reading, then used to prefill the loan or lease form where you can correct anything before creating the item.",
      "The original PDF is stored with the item, so the source document stays attached to your workpaper trail.",
      "Extraction requires the document reading service to be configured in Settings. If the document is scanned or unusual, verify the extracted numbers against the agreement — the reasoning notes call out any conversions or assumptions made.",
    ],
    related: ["loans-leases", "lease-classification", "clients-files"],
  },
  {
    id: "workpapers-exports",
    title: "Workpapers & Exports",
    screen: "Year-End File and Loan Detail pages",
    keywords: ["export", "workpaper", "excel", "xlsx", "pdf", "word", "docx", "disclosure", "note", "lead sheet", "download", "journal entries"],
    body: [
      "From a year-end file, the Workpapers buttons export a complete engagement package — a lead sheet summarizing every loan and lease plus a supporting schedule for each item — as Excel or PDF.",
      "From a loan detail page you can export that item's full amortization schedule and annual breakdown as Excel or PDF, and a per-loan workpaper with its schedules, journal entries, and disclosure support.",
      "Note disclosures (long-term debt continuity, current vs. long-term split, five-year principal repayments and thereafter, lease commitments) are generated from the schedules and included in the workpapers.",
      "Covenant violations flow into the exports too: the lead sheet marks violated items and shows the current portion split between amounts due within one year and amounts due beyond one year that are callable, with an explanatory ASPE 1510 note.",
      "Journal entries are always computed from the current schedules when you export, so they never go stale after you edit a loan.",
      "The standalone calculator also offers quick exports, including an ASPE note disclosure in Word format.",
    ],
    related: ["standalone-calculator", "amortization-schedules", "review-checklist"],
  },
  {
    id: "review-checklist",
    title: "Review Checklist & Diagnostics",
    screen: "Year-End File and Loan Detail pages",
    keywords: ["review", "checklist", "diagnostics", "findings", "warnings", "dismiss", "quality", "completeness", "materiality"],
    body: [
      "The app continuously runs diagnostics over the year-end file and each loan, surfacing findings such as missing fair value decisions on low-rate loans, missing security descriptions, loans maturing within 12 months, unusual terms, and incomplete lease inputs.",
      "File-level findings appear on the year-end file page; loan-level findings appear on each loan's detail page.",
      "Each finding can be dismissed once you've considered it — dismissals are saved with the file or loan so the checklist reflects your review state.",
      "Findings use the file's trivial threshold and materiality where relevant, so set those on the year-end file for the most useful guidance.",
    ],
    related: ["clients-files", "fair-value", "workpapers-exports"],
  },
  {
    id: "standalone-calculator",
    title: "Standalone Calculator",
    screen: "Quick calculator",
    keywords: ["calculator", "quick", "standalone", "scratch", "what-if", "scenario"],
    body: [
      "The standalone calculator is a scratch-pad amortization tool: enter a principal, rate, amortization period, term, start date, and year end to instantly see the payment, full schedule, annual fiscal-year breakdown, and balance chart — without creating a client or file.",
      "It supports the same mechanics as saved loans: interest-only months (initial or specific months), balloon payments, and all payment frequencies.",
      "Use it for quick what-if scenarios or one-off client questions; when the loan belongs in an engagement, add it to a year-end file instead so it flows into workpapers and disclosures.",
      "Exports include the schedule and annual breakdown (Excel/PDF) and a draft ASPE long-term debt note disclosure in Word format.",
    ],
    related: ["amortization-schedules", "workpapers-exports", "loans-leases"],
  },
];

export function getTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

export function getDefaultTopicId(path: string): string {
  if (/^\/client\/[^/]+\/file\/[^/]+\/loan\//.test(path)) return "amortization-schedules";
  if (/^\/client\/[^/]+\/file\//.test(path)) return "loans-leases";
  if (/^\/client\//.test(path)) return "clients-files";
  return "overview";
}

export function searchTopics(query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_TOPICS;
  const terms = q.split(/\s+/);
  return HELP_TOPICS.map((topic) => {
    const title = topic.title.toLowerCase();
    const keywords = topic.keywords.join(" ").toLowerCase();
    const body = topic.body.join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      else if (keywords.includes(term)) score += 3;
      else if (body.includes(term)) score += 1;
      else return { topic, score: 0 };
    }
    return { topic, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.topic);
}
