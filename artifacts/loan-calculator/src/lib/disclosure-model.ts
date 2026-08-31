import type { FileSummary } from "./aspe-utils";

export const DISCLOSURE_MODEL_VERSION = "presentation-disclosure/v1";

export interface DisclosureAgreementInput {
  id: string;
  name: string;
  rolledFromId?: string | null;
  counterparty?: string | null;
  masterAgreementId?: string | null;
  securityClauses?: string[] | null;
  collateralType?: string | null;
  collateralDescription?: string | null;
  covenantViolation?: boolean | null;
  predecessorAgreementId?: string | null;
  predecessorAgreement?: { id: string } | null;
  modificationEffectiveDate?: string | null;
  modificationAssessment?: {
    status: string;
    conclusion: { accountingTreatment: string };
  } | null;
  currentRevisionId?: string | null;
  currentRevisionHash?: string | null;
  calculationVersion?: string | null;
  activeEventSetId?: string | null;
  activeEventSetVersion?: number | null;
  activeEventSetHash?: string | null;
  activeRateSetId?: string | null;
  rateTimelineEvents?: readonly unknown[] | null;
  activeRateEvents?: readonly unknown[] | null;
}

export interface DisclosureMasterInput {
  id: string;
  lender: string;
  securityDescription?: string | null;
  covenantDescription?: string | null;
}

export interface DisclosureComparativeInput {
  /** Canonical summary built from the actual rolled-from file population. */
  summary: FileSummary;
  fiscalYearEnd: string;
  sourceFileId: string;
  /** Source IDs followed from current agreements' rolledFromId fields. */
  rolledFromLoanIds: readonly string[];
}

export interface BuildDisclosureModelInput {
  clientName: string;
  fileName?: string | null;
  fiscalYearEnd: string;
  /** Authoritative source file lineage from the current Year-End File. */
  rolledFromFileId?: string | null;
  /** Already hydrated current-file reporting population. */
  agreements: readonly DisclosureAgreementInput[];
  /** Existing canonical buildFileSummary result. */
  summary: FileSummary;
  masters?: readonly DisclosureMasterInput[];
  comparative?: DisclosureComparativeInput | null;
  /** Must reflect completion of every required external predecessor query. */
  reportingTransitionsReady: boolean;
}

export interface DisclosureAmount {
  current: number;
  comparative: number | null;
}

export interface DisclosureMaturityRow {
  label: string;
  loans: number;
  capitalLeases: number;
  operatingLeases: number;
  total: number;
}

export interface DisclosureModel {
  modelVersion: typeof DISCLOSURE_MODEL_VERSION;
  modelFingerprint: string;
  clientName: string;
  fileName: string | null;
  reportingFiscalYearEnd: string;
  comparativeFiscalYearEnd: string | null;
  scopeStatement: string;
  evidence: {
    evidenceVersion: "disclosure-evidence/v1";
    calculationVersions: string[];
    revisionIds: string[];
    revisionFingerprints: string[];
    eventSetVersions: string[];
    eventSetFingerprints: string[];
    rateSetIds: string[];
    inputFingerprints: string[];
    comparativeSourceFileId: string | null;
    comparativeRolledFromLoanIds: string[];
    state: "resolved";
  };
  balanceSheet: {
    loans: { total: DisclosureAmount; current: DisclosureAmount; nonCurrent: DisclosureAmount };
    capitalLeases: { total: DisclosureAmount; current: DisclosureAmount; nonCurrent: DisclosureAmount };
    totalDebt: { total: DisclosureAmount; current: DisclosureAmount; nonCurrent: DisclosureAmount };
    operatingLeases: {
      count: DisclosureAmount;
      commitments: DisclosureAmount;
      deferredRentAsset: DisclosureAmount;
      deferredRentLiability: DisclosureAmount;
      incentiveLiability: DisclosureAmount;
      incentiveCurrent: DisclosureAmount;
      incentiveNonCurrent: DisclosureAmount;
    };
  };
  operations: {
    interestExpense: DisclosureAmount;
    straightLineRentExpense: DisclosureAmount;
    leaseInducementAmortization: DisclosureAmount;
  };
  cashFlows: {
    loanProceeds: DisclosureAmount;
    loanPrincipalRepayments: DisclosureAmount;
    capitalLeasePrincipalRepayments: DisclosureAmount;
    operatingLeasePayments: DisclosureAmount;
    cashLeaseInducements: DisclosureAmount;
  };
  nonCashItems: { leaseInducements: DisclosureAmount };
  maturities: DisclosureMaturityRow[];
  securityAndCovenants: Array<{
    agreementId: string;
    agreementName: string;
    counterparty: string | null;
    security: string[];
    covenant: string | null;
    covenantViolation: boolean;
  }>;
  transitions: Array<{
    successorAgreementId: string;
    predecessorAgreementId: string;
    effectiveDate: string;
    treatment: string;
    presentation: "single_timeline_no_double_count";
  }>;
}

export class DisclosureEvidenceError extends Error {
  readonly code = "UNRESOLVED_DISCLOSURE_EVIDENCE";
  constructor(message: string) {
    super(message);
    this.name = "DisclosureEvidenceError";
  }
}

const amount = (current: number, comparative?: number): DisclosureAmount => ({
  current,
  comparative: comparative ?? null,
});

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => !!value))).sort();

const maturityMap = (summary: FileSummary, key: "loans" | "capitalLeases" | "operatingLeases") => {
  const map = new Map<string, number>();
  if (key === "operatingLeases") {
    for (const item of summary.operatingLeases) {
      for (const row of item.yearlyPayments) map.set(row.label, (map.get(row.label) ?? 0) + row.amount);
    }
  } else {
    const items = key === "loans" ? summary.loans : summary.capitalLeases;
    for (const item of items) {
      for (const row of item.yearlyPrincipal) map.set(row.label, (map.get(row.label) ?? 0) + row.amount);
    }
  }
  return map;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Builds presentation data only from hydrated inputs and canonical summaries. */
export function buildDisclosureModel(input: BuildDisclosureModelInput): DisclosureModel {
  if (!input.reportingTransitionsReady) {
    throw new DisclosureEvidenceError("Required external predecessor evidence is unresolved.");
  }
  for (const agreement of input.agreements) {
    if (agreement.predecessorAgreementId && !agreement.predecessorAgreement) {
      throw new DisclosureEvidenceError(`Predecessor ${agreement.predecessorAgreementId} for ${agreement.name} is unresolved.`);
    }
  }
  if (input.rolledFromFileId && !input.comparative) {
    throw new DisclosureEvidenceError("Comparative figures are unresolved for the rolled-from Year-End File.");
  }
  if (
    input.comparative &&
    input.rolledFromFileId &&
    input.comparative.sourceFileId !== input.rolledFromFileId
  ) {
    throw new DisclosureEvidenceError("Comparative figures do not match the Year-End File's rolled-from lineage.");
  }
  if (input.comparative) {
    const actualRolledFromIds = new Set(input.agreements.map((agreement) => agreement.rolledFromId).filter(Boolean));
    if (
      input.comparative.rolledFromLoanIds.length > 0 &&
      input.comparative.rolledFromLoanIds.some((id) => !actualRolledFromIds.has(id))
    ) {
      throw new DisclosureEvidenceError("Comparative figures are not supported by the current population's rolledFrom lineage.");
    }
  }

  const prior = input.comparative?.summary;
  const mk = (current: number, previous?: number) => amount(current, previous);
  const masterById = new Map((input.masters ?? []).map((master) => [master.id, master]));
  const securityAndCovenants = input.agreements
    .filter((agreement) => {
      const master = agreement.masterAgreementId ? masterById.get(agreement.masterAgreementId) : undefined;
      return !!agreement.securityClauses?.length || !!agreement.collateralType || !!agreement.collateralDescription ||
        !!master?.securityDescription || !!master?.covenantDescription || !!agreement.covenantViolation;
    })
    .map((agreement) => {
      const master = agreement.masterAgreementId ? masterById.get(agreement.masterAgreementId) : undefined;
      return {
        agreementId: agreement.id,
        agreementName: agreement.name,
        counterparty: agreement.counterparty?.trim() || null,
        security: unique([
          ...(agreement.securityClauses ?? []),
          agreement.collateralDescription || agreement.collateralType,
          agreement.securityClauses?.length ? null : master?.securityDescription,
        ]),
        covenant: master?.covenantDescription ?? null,
        covenantViolation: !!agreement.covenantViolation,
      };
    })
    .sort((a, b) => a.agreementName.localeCompare(b.agreementName) || a.agreementId.localeCompare(b.agreementId));

  const currentMaturities = {
    loans: maturityMap(input.summary, "loans"),
    capitalLeases: maturityMap(input.summary, "capitalLeases"),
    operatingLeases: maturityMap(input.summary, "operatingLeases"),
  };
  const labels = unique([...currentMaturities.loans.keys(), ...currentMaturities.capitalLeases.keys(), ...currentMaturities.operatingLeases.keys()]);
  const maturities = labels.map((label) => {
    const loans = currentMaturities.loans.get(label) ?? 0;
    const capitalLeases = currentMaturities.capitalLeases.get(label) ?? 0;
    const operatingLeases = currentMaturities.operatingLeases.get(label) ?? 0;
    return { label, loans, capitalLeases, operatingLeases, total: loans + capitalLeases + operatingLeases };
  });

  const evidence = {
    evidenceVersion: "disclosure-evidence/v1" as const,
    calculationVersions: unique(input.agreements.map((x) => x.calculationVersion)),
    revisionIds: unique(input.agreements.map((x) => x.currentRevisionId)),
    revisionFingerprints: unique(input.agreements.map((x) => x.currentRevisionHash)),
    eventSetVersions: unique(input.agreements.map((x) =>
      x.activeEventSetId ? `${x.activeEventSetId}@${x.activeEventSetVersion ?? "unversioned"}` : null)),
    eventSetFingerprints: unique(input.agreements.map((x) => x.activeEventSetHash)),
    rateSetIds: unique(input.agreements.map((x) => x.activeRateSetId)),
    inputFingerprints: input.agreements.map((agreement) => fingerprint({
      id: agreement.id,
      revision: agreement.currentRevisionHash,
      eventSet: agreement.activeEventSetHash,
      rateSet: agreement.activeRateSetId,
      predecessor: agreement.predecessorAgreementId,
      transitionDate: agreement.modificationEffectiveDate,
      transitionStatus: agreement.modificationAssessment?.status,
    })).sort(),
    comparativeSourceFileId: input.comparative?.sourceFileId ?? null,
    comparativeRolledFromLoanIds: unique([...(input.comparative?.rolledFromLoanIds ?? [])]),
    state: "resolved" as const,
  };
  const transitions = input.agreements.flatMap((agreement) =>
    agreement.predecessorAgreementId && agreement.modificationAssessment?.status === "confirmed" && agreement.modificationEffectiveDate
      ? [{
          successorAgreementId: agreement.id,
          predecessorAgreementId: agreement.predecessorAgreementId,
          effectiveDate: agreement.modificationEffectiveDate,
          treatment: agreement.modificationAssessment.conclusion.accountingTreatment,
          presentation: "single_timeline_no_double_count" as const,
        }]
      : []);

  const modelWithoutFingerprint = {
    modelVersion: DISCLOSURE_MODEL_VERSION as typeof DISCLOSURE_MODEL_VERSION,
    clientName: input.clientName,
    fileName: input.fileName ?? null,
    reportingFiscalYearEnd: input.fiscalYearEnd,
    comparativeFiscalYearEnd: input.comparative?.fiscalYearEnd ?? null,
    scopeStatement: "Consolidated presentation and disclosure for all loans and capital and operating leases in this Year-End File.",
    evidence,
    balanceSheet: {
      loans: {
        total: mk(input.summary.loanTotal, prior?.loanTotal),
        current: mk(input.summary.loanCurrent, prior?.loanCurrent),
        nonCurrent: mk(input.summary.loanLongTerm, prior?.loanLongTerm),
      },
      capitalLeases: {
        total: mk(input.summary.leaseTotal, prior?.leaseTotal),
        current: mk(input.summary.leaseCurrent, prior?.leaseCurrent),
        nonCurrent: mk(input.summary.leaseLongTerm, prior?.leaseLongTerm),
      },
      totalDebt: {
        total: mk(input.summary.totalDebt, prior?.totalDebt),
        current: mk(input.summary.totalCurrent, prior?.totalCurrent),
        nonCurrent: mk(input.summary.totalLongTerm, prior?.totalLongTerm),
      },
      operatingLeases: {
        count: mk(input.summary.operatingLeaseCount, prior?.operatingLeaseCount),
        commitments: mk(input.summary.operatingLeaseTotalCommitment, prior?.operatingLeaseTotalCommitment),
        deferredRentAsset: mk(input.summary.deferredRentAsset, prior?.deferredRentAsset),
        deferredRentLiability: mk(input.summary.deferredRentLiability, prior?.deferredRentLiability),
        incentiveLiability: mk(input.summary.leaseIncentiveLiability, prior?.leaseIncentiveLiability),
        incentiveCurrent: mk(input.summary.leaseIncentiveCurrent, prior?.leaseIncentiveCurrent),
        incentiveNonCurrent: mk(input.summary.leaseIncentiveNonCurrent, prior?.leaseIncentiveNonCurrent),
      },
    },
    operations: {
      interestExpense: mk(input.summary.totalInterestExpense, prior?.totalInterestExpense),
      straightLineRentExpense: mk(input.summary.totalStraightLineRentExpense, prior?.totalStraightLineRentExpense),
      leaseInducementAmortization: mk(input.summary.totalLeaseInducementAmortization, prior?.totalLeaseInducementAmortization),
    },
    cashFlows: {
      loanProceeds: mk(input.summary.totalLoanProceeds, prior?.totalLoanProceeds),
      loanPrincipalRepayments: mk(input.summary.totalLoanPrincipalRepaid, prior?.totalLoanPrincipalRepaid),
      capitalLeasePrincipalRepayments: mk(input.summary.totalCapitalLeasePrincipalRepaid, prior?.totalCapitalLeasePrincipalRepaid),
      operatingLeasePayments: mk(input.summary.totalOperatingLeaseCash, prior?.totalOperatingLeaseCash),
      cashLeaseInducements: mk(input.summary.cashInducementsReceived, prior?.cashInducementsReceived),
    },
    nonCashItems: { leaseInducements: mk(input.summary.nonCashInducementsReceived, prior?.nonCashInducementsReceived) },
    maturities,
    securityAndCovenants,
    transitions,
  };
  return { ...modelWithoutFingerprint, modelFingerprint: fingerprint(modelWithoutFingerprint) };
}
