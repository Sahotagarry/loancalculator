import { isAfter, parseISO } from "date-fns";

export function getFiscalYear(
  date: Date,
  fyEndMonth: number,
  fyEndDay: number,
): number {
  const year = date.getFullYear();
  const fyEnd = new Date(year, fyEndMonth, fyEndDay);
  if (isAfter(date, fyEnd)) return year + 1;
  return year;
}

export function getFyEndParts(fyEndDate: string): { month: number; day: number } {
  const d = parseISO(fyEndDate);
  return { month: d.getMonth(), day: d.getDate() };
}
