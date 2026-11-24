import { addMonths, format, isValid, parseISO } from "date-fns";
import type { AssessmentAnswers } from "../components/capital-lease-assessment";
import { assessmentStartDate } from "./lease-assessment-values";

function firstRental(date: string, advance: boolean) {
  const start = parseISO(date);
  return isValid(start) ? format(addMonths(start, advance ? 0 : 1), "yyyy-MM-dd") : "";
}

/** Keep a separately entered payment date; move only the ordinary derived monthly anchor. */
export function assessmentCalendarUpdate(a: AssessmentAnswers, loan: {
  startDate: string; paymentTiming?: string | null; firstPaymentDate?: string | null;
}) {
  const startDate = assessmentStartDate(a, loan.startDate);
  const oldDerived = firstRental(loan.startDate, loan.paymentTiming === "beginning");
  const derived = !loan.firstPaymentDate || loan.firstPaymentDate === oldDerived;
  return { startDate, ...(derived ? { firstPaymentDate: firstRental(startDate, a.paymentAtBeginning) || null } : {}) };
}
