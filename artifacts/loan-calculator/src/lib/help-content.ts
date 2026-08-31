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
    id: "renewals-modifications",
    title: "Renewals, Modifications, and Lease Transitions",
    screen: "Loan and lease agreement assessment",
    keywords: ["renewal", "modification", "predecessor", "successor", "effective date", "extinguishment", "termination", "fees", "costs"],
    body: [
      "Link a successor only to the agreement it legally replaces, record the effective date, and confirm the persisted assessment. Reporting keeps predecessor activity through that date and successor activity afterward, so overlapping complete schedules are never double counted.",
      "For a debt modification that is a continuation, the predecessor carrying amount continues. Retained and new transaction fees or costs are included in the prospective effective-interest basis. For an extinguishment, derecognize the predecessor and present the resulting gain or loss separately from the new financing.",
      "An operating lease transition clears predecessor deferred-rent balances. A capital lease transition derecognizes the old obligation and leased asset (including accumulated depreciation). A new capital lease is recognized separately at commencement.",
      "Exports retain the change summary, contractual-change evidence, conclusion, rationale, confirmer, and confirmation timestamp. Diagnostics flag incomplete links or unconfirmed assessments.",
    ],
    related: ["amortization-schedules", "lease-classification", "workpapers-exports", "review-checklist"],
  },
  {
    id: "prime-linked-rates",
    title: "Prime-Linked Rates and Day-One Fair Value",
    screen: "Loan detail — Rate timeline",
    keywords: ["prime", "variable", "benchmark", "boc", "override", "reset", "fair value", "frozen"],
    body: [
      "A public Bank of Canada benchmark is evidence, not automatically the lender's contractual prime. Confirm contractual equivalence explicitly only where supported by the agreement; otherwise obtain the lender rate or enter an evidenced override. The app does not silently substitute a fallback rate.",
      "Each reset is dated by its observation, publication, fetch, and contractual effective dates. The timeline records the benchmark, spread, resulting contractual rate, source, and whether it was sourced, overridden, or restored. Restoring source evidence preserves the override history.",
      "Keep payment leaves the regular installment unchanged and changes the payoff path. Keep maturity prospectively recasts remaining amortizing payments to retain the contractual maturity. Ordinary original-agreement resets are not modifications; changed reset terms require a modification assessment.",
      "Initial-recognition fair value uses the approved, frozen expected-rate assumption and original effective/market rate. Later realized prime resets update contractual interest prospectively but never rewrite that day-one assumption or its FV evidence.",
    ],
    related: ["fair-value", "amortization-schedules", "review-checklist"],
  },
  {
    id: "mid-term-payments",
    title: "Mid-term Principal Payments",
    screen: "Loan Detail page",
    keywords: ["prepayment", "lump sum", "principal payment", "event", "recast", "keep maturity", "early payoff", "modification"],
    body: [
      "Use Mid-term Principal Payments for a documented lump-sum payment after inception and before maturity. It is principal-only: interest accrued to the event date is not silently forgiven and is settled at the applicable scheduled due date.",
      "Choose whether the lender keeps the regular payment (which can pay the loan off earlier) or keeps contractual maturity (which recalculates only future payments). For an event on a payment date, choose Before or After scheduled payment; same-day events are then ordered by sequence.",
      "Events are append-only evidence. Saving an edit creates a successor version of the complete ordered event set, rather than changing the original event. The preview shows the resulting payment, payoff, maturity, interest, and ending balance before you save.",
      "If a payment changes the agreement, classify it as an agreement change and complete the renewal/modification assessment instead of saving it as an ordinary prepayment. PDF-extracted suggestions are never saved automatically: acknowledge and complete uncertain treatment or classification first.",
    ],
    related: ["amortization-schedules", "pdf-import", "workpapers-exports"],
  },
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
    related: ["access-security", "clients-files", "loans-leases", "workpapers-exports"],
  },
  {
    id: "access-security",
    title: "Sign-In, Roles & Client Access",
    screen: "All screens; Settings — Access & Users",
    keywords: ["sign in", "login", "microsoft", "entra", "role", "administrator", "manager", "accountant", "read only", "access", "permission", "membership", "adopt", "quarantine", "settings", "403", "401"],
    body: [
      "In production, sign in with the Microsoft work account that your administrator has added to the application. Replit previews use the fixed Development Administrator for testing. “Authentication required” means no valid sign-in was received; “Access has not been granted” means the signed-in Microsoft account has not been added; “Insufficient role” means the account cannot perform that action.",
      "Administrators can manage staff, client assignments, Azure Integration settings, restores, and permanent purges. Managers can perform normal accounting work and move items to or restore them from Trash, but cannot manage access, settings, or permanently purge data. Accountants can create and edit accounting records but cannot delete, restore, or administer access. Read Only users can review information and exports but cannot change records.",
      "Administrators use Settings > Access & Users to add staff with their exact Entra Object ID, choose a role, and activate or deactivate access. There is no separate Settings password or unlock step: access is controlled by Microsoft identity and the Administrator role.",
      "Clients created before access controls were introduced appear under Quarantined Legacy Clients. An administrator must choose Adopt Client and select its initial members before anyone can access it. Adoption does not grant access to every user. After adoption, use Manage Access under Adopted Clients to change assignments; the acting administrator is retained so the client cannot be orphaned.",
      "A user sees only adopted clients assigned to them. If a known client is missing, ask an administrator to confirm that the client has been adopted, the user is active, and the user is included in that client's access list.",
    ],
    related: ["clients-files", "trash-recovery", "pdf-import", "workpapers-exports"],
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
      "One-step roll-forward creates the next year's file in a single click: it copies all outstanding loans and leases to a new file with the next fiscal year end. Set the file name, materiality, and trivial thresholds right in the dialog so the new file is immediately ready. Fully paid matured items are skipped, but outstanding or covenant-violated matured items are carried over so comparatives stay complete. Inherited evidence like fair-value decisions flows through automatically.",

      "Deleting a client, Year-End File, loan, or lease moves it to Trash rather than removing it immediately. Managers and administrators can restore recoverable items; only administrators can permanently purge them. Restoring a client also restores its deleted Year-End Files and items, and restoring a Year-End File also restores its deleted loans and leases.",
    ],
    related: ["overview", "access-security", "trash-recovery", "loans-leases", "review-checklist"],
  },
  {
    id: "trash-recovery",
    title: "Trash, Restore & Permanent Purge",
    screen: "Trash page",
    keywords: ["trash", "delete", "deleted", "restore", "recover", "purge", "permanent", "manager", "administrator"],
    body: [
      "Deleting a client, Year-End File, loan, or lease is a recoverable action: the item moves to Trash and disappears from normal working screens. Its accounting information and attached source document remain associated with it while it is in Trash.",
      "Managers and administrators can open Trash and restore items. Restoring a client restores its deleted Year-End Files and their deleted loans or leases; restoring a Year-End File restores its deleted loans or leases. This prevents a child record from being restored under a parent that is still unavailable.",
      "Permanent purge is restricted to administrators and cannot be undone. Purging a client removes its Year-End Files, loans, leases, master agreements, and owned document records; purging a Year-End File removes the items and documents inside that file. Confirm the correct client and backup requirements before using a permanent action.",
      "Accountants and Read Only users cannot delete or restore records. “Manager access required” means your role does not permit Trash operations.",
    ],
    related: ["access-security", "clients-files", "pdf-import"],
  },
  {
    id: "loans-leases",
    title: "Loans & Capital Leases",
    screen: "Year-End File and Loan Detail pages",
    keywords: ["loan", "capital lease", "operating lease", "add loan", "principal", "interest rate", "term", "amortization period", "balloon", "interest-only", "payment frequency", "payment timing", "first payment date", "grace", "semi-monthly", "counterparty", "security", "collateral"],
    body: [
      "From a year-end file, the 'Add Loan or Lease' button offers three ways to add an item: Import from PDF (AI reads the signed agreement and prefills the right form — works for loans and leases), Add Loan (enter loan terms directly), and Add Lease (a guided assessment that classifies the lease as capital or operating under ASPE 3065).",
      "Three kinds of items result: loans, capital leases, and operating leases. Loans and capital leases produce amortization schedules; operating leases are straight-lined under ASPE 3065.",
      "For a loan you enter the principal, interest rate, amortization period, term, start date, and payment frequency (monthly, semi-monthly, bi-weekly, or weekly). Optional inputs include a down payment, interest-only months, a balloon payment, a payment override, and security/collateral details.",
      "Set whether payments are due at the beginning or end of each period and, when known, the first payment date. New records default to end-of-period timing and grace included in the stated term. Leaving first payment date blank on an older record deliberately retains its legacy inception-date schedule anchor.",
      "For semi-monthly agreements, enter both contractual due days (for example, 1 and 15); dates falling beyond a month-end use that month's last day. A payment grace period can be included in the stated term (a 60-month term with 13 grace months has 47 repayment months) or added to it (60 repayment + 13 grace = 73 total months).",
      "Capital leases are created through the Add Lease assessment (not the loan form). They capture the same payment mechanics as loans plus the ASPE 3065 classification criteria and the leased asset's cost and useful life, so the app can build both the lease liability schedule and the asset depreciation schedule.",
      "Status badges on each item flag things like maturity within 12 months (fully current), balloon payments coming due, active interest-only periods, expired leases, and covenant violations (shown in red).",
      "Opening any item shows its full schedule, annual fiscal-year totals, charts, journal entries, disclosures, and a per-item review checklist.",
    ],
    related: ["down-payments", "amortization-schedules", "mid-term-payments", "lease-classification", "fair-value", "covenant-violations"],
  },
  {
    id: "master-agreements",
    title: "Master Financing Agreements",
    screen: "Year-End File page",
    keywords: ["master agreement", "master financing agreement", "facility", "facilities", "credit facility", "term sheet", "credit limit", "lender", "group", "grouped", "standalone"],
    body: [
      "A master financing agreement represents one umbrella credit agreement with a lender under which the borrower draws several facilities (individual loans). Use it when a client has, for example, a single bank agreement covering an operating facility, a term loan, and an equipment loan — the facilities stay grouped together instead of appearing as unrelated loans.",
      "Create one from the year-end file page with 'Add Master Agreement'. The lender is required; you can also record a description (e.g. the agreement date), the overall credit limit, shared security/collateral, and covenant terms that apply across the agreement.",
      "Link facilities in two ways: when adding or editing a loan, pick the master in the 'Master Agreement' dropdown (or leave it as a standalone loan), or import the master agreement PDF — the app detects a master financing agreement, shows the shared terms and each facility it found, and creates the master plus the facilities you keep selected in one step.",
      "When you link a facility, the master's lender and security are used as defaults where the facility has none — anything you enter on the facility itself takes priority. Facility-specific terms like the rate, amount, and payment schedule always live on the facility, so details finalized later in a term sheet are simply edited on that facility.",
      "On the year-end file page, linked facilities appear inside a bordered group under the master's lender and description, with the facility count, the outstanding balance subtotal, and the overall credit limit when one was entered. A master with no facilities yet stays visible so you can link or add them later.",
      "Deleting a master agreement does not delete its facilities — they simply become standalone loans again (any security copied from the master stays with them). Roll forward carries the whole structure into the next year's file: masters are copied and the outstanding facilities stay grouped under them.",
    ],
    related: ["loans-leases", "pdf-import", "clients-files"],
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
      "Loans bearing interest below market rates (the app flags rates of 3% or lower) may need to be measured at fair value under ASPE 3856 by discounting the contractual payments at a market rate. Zero-rate related-party or forgivable loans always trigger this check.",
      "You must record an explicit confirmation decision on each flagged loan: use fair value, treat the difference as trivial, or treat as immaterial. A rate-only save does not complete the assessment; you must explicitly confirm the accounting treatment.",
      "The app suggests a market rate based on the Bank of Canada prime rate at the loan's start date (prime + 2%). For prime-linked agreements, the fair value calculation requires that the day-one prime-linked expected rate assumptions be explicitly frozen.",
      "When fair value is adopted, the booked schedule uses the effective-interest method: contractual payments stay fixed, but interest accrues at the market rate on the discounted carrying amount. The contractual schedule remains available on a comparison tab.",
      "For each fiscal year the app builds distinct balanced accounting entries: a day-one fair value recognition entry and an annual effective-interest accretion entry, alongside a supporting cumulative unrecorded adjustment reconciliation.",
      "If the underlying contract terms, event history, or modification assessments change, the previously confirmed fair value decision becomes stale and requires reconfirmation."
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
      "Instead of typing loan or lease terms by hand, choose 'Import from PDF' from the Add Loan or Lease menu and upload the signed agreement — the app reads it for you. It classifies the document as a loan, a lease (capital or operating), or a master financing agreement, and extracts the key terms: names, dates, amounts, rates, term, payment frequency, and more.",
      "For commercial office leases it also picks up the rentable square footage, converts per-square-foot annual rates into monthly rent, builds the stepped rent schedule by lease year, and extracts the tenant improvement allowance and any free-rent period.",
      "You always review before saving: the extracted fields are shown with a confidence level and the reasoning behind the reading, then used to prefill the loan or lease form where you can correct anything before creating the item.",
      "If the document is a master financing agreement covering several facilities, the app shows the shared terms and lists each facility it found — you choose which to keep, and it creates the master agreement with those facilities grouped under it in one step.",
      "Uploads must be PDF files and cannot exceed 20 MB. Messages such as “Only PDF files are supported,” “No PDF file was uploaded,” or an invalid-PDF warning mean the file must be corrected before extraction can continue.",
      "The original PDF is stored securely with the item and can be downloaded from its source-document link. Access follows the same firm, client, and Year-End File permissions as the accounting record; a copied link cannot be used to open another client's document.",
      "A roll-forward keeps the source document with the original Year-End File rather than copying its document link into the next year. Attach the new year's executed or supporting document to the rolled-forward item when appropriate.",
      "Extraction requires the document reading service to be configured in Settings. If the document is scanned or unusual, verify the extracted numbers against the agreement — the reasoning notes call out any conversions or assumptions made.",
    ],
    related: ["loans-leases", "lease-classification", "clients-files", "access-security", "trash-recovery"],
  },
  {
    id: "workpapers-exports",
    title: "Workpapers & Exports",
    screen: "Year-End File and Loan Detail pages",
    keywords: ["export", "workpaper", "excel", "xlsx", "pdf", "word", "docx", "disclosure", "note", "lead sheet", "download", "journal entries"],
    body: [
      "The opening Year-End File page places all consolidated exports in its header. Consolidated Lead Sheet offers Excel (.xlsx) and PDF; Supporting Workpapers offers Excel (.xlsx) and PDF; Word Disclosure and PDF Disclosure download the formal presentation and note-disclosure report.",
      "Use Consolidated Lead Sheet for the reviewer's at-a-glance summary of every loan and lease in the file, including balances, current and long-term classification, status flags, and maturity groupings.",
      "Use Supporting Workpapers for the complete audit/review package. The Excel workbook starts with the consolidated lead sheet and then includes separate detail and amortization tabs for the loans and leases in the file; the PDF provides the corresponding combined package.",
      "Use Word Disclosure or PDF Disclosure for finalized financial-statement presentation and note-disclosure support. These reports consolidate the entire Year-End File and include prior-year comparatives when the file was rolled forward.",
      "An export is disabled when there are no applicable loans or when required reporting evidence is incomplete. Complete unresolved modification, predecessor, or comparative evidence and review the diagnostics before trying again.",
      "Covenant violations flow everywhere automatically: violated items are classified as current on the lead sheet, split into callable/due-within-one-year in the disclosures, and documented in the individual workpapers."
    ],
    related: ["access-security", "standalone-calculator", "amortization-schedules", "review-checklist"],
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
  if (/^\/settings(?:\/access)?\/?$/.test(path)) return "access-security";
  if (/^\/trash\/?$/.test(path)) return "trash-recovery";
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
