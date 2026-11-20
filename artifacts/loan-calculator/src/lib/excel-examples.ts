import { file, schedule, evidence, annualRows } from "./excel-example-data";
import { buildScheduleWorkbook, buildAnnualWorkbook } from "./loan-report-workbook";
import { buildFileWorkbook } from "./file-report-workbook";
import { saveWorkbook } from "./excel-report-style";

const examples = {
  Schedule: () => buildScheduleWorkbook(schedule, evidence),
  Annual: () => buildAnnualWorkbook(annualRows(), evidence),
  "Lead-Sheet": () => buildFileWorkbook(file, false)!,
  "Supporting-Workpapers": () => buildFileWorkbook(file, true)!,
};
export function downloadExcelExample(kind: keyof typeof examples) {
  return saveWorkbook(examples[kind](), `Illustrative-${kind}.xlsx`);
}
