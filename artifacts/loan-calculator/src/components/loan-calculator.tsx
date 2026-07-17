import { useState, useMemo } from "react";
import { calculateAmortization, type Frequency } from "@workspace/amortization";
import { formatCurrency } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";
import {
  format,
  parseISO,
  getYear,
  addYears,
  isBefore,
  isAfter,
  startOfYear,
  endOfYear,
  addMonths,
} from "date-fns";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
} from "docx";
import { saveAs } from "file-saver";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function LoanCalculator() {
  const [principal, setPrincipal] = useState<number>(300000);
  const [interestRate, setInterestRate] = useState<number>(5.5);
  const [amortizationYears, setAmortizationYears] = useState<number>(25);
  const [termYears, setTermYears] = useState<number>(5);
  const [startDateStr, setStartDateStr] = useState<string>("");
  const [yearEndDateStr, setYearEndDateStr] = useState<string>(
    format(new Date(), "yyyy-12-31"),
  );
  const [initialIOMonths, setInitialIOMonths] = useState<number>(0);
  const [specificIOMonths, setSpecificIOMonths] = useState<number[]>([]);
  const [balloonPayment, setBalloonPayment] = useState<number>(0);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [showIO, setShowIO] = useState<boolean>(false);

  const startDate = useMemo(
    () => parseISO(startDateStr),
    [startDateStr],
  );

  const result = useMemo(
    () =>
      calculateAmortization(
        principal,
        interestRate,
        amortizationYears,
        termYears,
        startDate,
        initialIOMonths,
        specificIOMonths,
        balloonPayment,
        frequency,
      ),
    [
      principal,
      interestRate,
      amortizationYears,
      termYears,
      startDate,
      initialIOMonths,
      specificIOMonths,
      balloonPayment,
      frequency,
    ],
  );


  const toggleSpecificMonth = (monthIndex: number) => {
    setSpecificIOMonths((prev) =>
      prev.includes(monthIndex)
        ? prev.filter((m) => m !== monthIndex)
        : [...prev, monthIndex],
    );
  };

  const yearlyTotals = useMemo(() => {
    const totals: Record<
      string,
      { principal: number; interest: number; yearEnd: Date }
    > = {};
    const reportYearEndBase = new Date(yearEndDateStr);
    const yearEndMonth = reportYearEndBase.getUTCMonth();
    const yearEndDay = reportYearEndBase.getUTCDate();

    result.schedule.forEach((row) => {
      // Determine which fiscal year this date belongs to
      const date = row.date;
      let fiscalYear = date.getFullYear();
      const currentYearEnd = new Date(fiscalYear, yearEndMonth, yearEndDay);

      if (isAfter(date, currentYearEnd)) {
        fiscalYear++;
      }

      const key = fiscalYear.toString();
      if (!totals[key]) {
        totals[key] = {
          principal: 0,
          interest: 0,
          yearEnd: new Date(fiscalYear, yearEndMonth, yearEndDay),
        };
      }
      totals[key].principal += row.principal;
      totals[key].interest += row.interest;
    });

    return Object.entries(totals)
      .map(([year, data]) => ({
        year: parseInt(year),
        label: `Year ending ${format(data.yearEnd, "MMM d, yyyy")}`,
        ...data,
      }))
      .sort((a, b) => a.year - b.year);
  }, [result.schedule, yearEndDateStr]);

  const chartData = useMemo(() => {
    const data = result.schedule;
    const step = Math.max(1, Math.floor(data.length / 120));
    return data
      .filter((_, i) => i % step === 0 || i === data.length - 1)
      .map((row) => ({
        ...row,
        dateLabel: format(row.date, "MMM yyyy"),
        balanceLabel: formatCurrency(row.balance),
        totalInterestLabel: formatCurrency(row.totalInterest),
      }));
  }, [result.schedule]);

  const downloadExcel = () => {
    const worksheetData = result.schedule.map((row) => ({
      Month: row.month,
      Date: format(row.date, "MMMM d, yyyy"),
      Payment: row.payment.toFixed(2),
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      "Total Interest": row.totalInterest.toFixed(2),
      Balance: row.balance.toFixed(2),
      Type: row.isInterestOnly ? "Interest Only" : "Standard",
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Amortization Schedule");

    // Auto-size columns
    const max_width = worksheetData.reduce(
      (w, r) => Math.max(w, r.Date.length),
      10,
    );
    worksheet["!cols"] = [
      { wch: 8 },
      { wch: max_width + 5 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
    ];

    XLSX.writeFile(
      workbook,
      `Amortization_Schedule_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
    );
  };

  const downloadAmortizationPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Loan Amortization Schedule", 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(
      `Principal: ${formatCurrency(principal)} | Interest: ${interestRate}% | Term: ${termYears} yrs | Amortization: ${amortizationYears} yrs`,
      14,
      30,
    );

    const tableData = result.schedule.map((row) => [
      row.month,
      format(row.date, "MMM d, yyyy"),
      formatCurrency(row.payment),
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.balance),
    ]);

    autoTable(doc, {
      startY: 40,
      head: [["Period", "Date", "Payment", "Principal", "Interest", "Balance"]],
      body: tableData,
      foot: [
        [
          "",
          "Total",
          formatCurrency(
            result.schedule.reduce((sum, r) => sum + r.payment, 0),
          ),
          formatCurrency(
            result.schedule.reduce((sum, r) => sum + r.principal, 0),
          ),
          formatCurrency(
            result.schedule.reduce((sum, r) => sum + r.interest, 0),
          ),
          "-",
        ],
      ],
      theme: "striped",
      headStyles: { fillColor: [24, 95, 45] },
    });

    doc.save(`Amortization_Schedule_${format(new Date(), "yyyy-MM-dd")}.pdf`);
  };

  const downloadAnnualExcel = () => {
    const worksheetData = yearlyTotals.map((row) => ({
      "Fiscal Year": row.label,
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      Total: (row.principal + row.interest).toFixed(2),
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Annual Breakdown");
    XLSX.writeFile(
      workbook,
      `Annual_Breakdown_${format(new Date(), "yyyy-MM-dd")}.xlsx`,
    );
  };

  const downloadAnnualPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Annual Loan Breakdown", 14, 22);

    const tableData = yearlyTotals.map((row) => [
      row.label,
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.principal + row.interest),
    ]);

    autoTable(doc, {
      startY: 40,
      head: [["Fiscal Year", "Principal", "Interest", "Total"]],
      body: tableData,
      foot: [
        [
          "Total",
          formatCurrency(yearlyTotals.reduce((sum, r) => sum + r.principal, 0)),
          formatCurrency(yearlyTotals.reduce((sum, r) => sum + r.interest, 0)),
          formatCurrency(
            yearlyTotals.reduce((sum, r) => sum + r.principal + r.interest, 0),
          ),
        ],
      ],
      theme: "grid",
      headStyles: { fillColor: [24, 95, 45] },
    });

    doc.save(`Annual_Breakdown_${format(new Date(), "yyyy-MM-dd")}.pdf`);
  };

  const downloadASPEDisclosure = async () => {
    // Calculate 5-year principal repayments
    const next5Years: { year: number; principal: number }[] = [];
    const reportYearEnd = new Date(yearEndDateStr);

    // Current vs Long-term calculation
    const currentPeriodEnd = addMonths(reportYearEnd, 12);

    // Re-calculating with more precise date comparison logic for ASPE
    const next12MonthsPrincipal = result.schedule
      .filter((row) => {
        return (
          isAfter(row.date, reportYearEnd) &&
          !isAfter(row.date, currentPeriodEnd)
        );
      })
      .reduce((sum, row) => sum + row.principal, 0);

    const totalDebtAtYearEnd =
      result.schedule
        .filter((row) => !isAfter(row.date, reportYearEnd))
        .slice(-1)[0]?.balance ?? principal;

    const longTermPortion = Math.max(
      0,
      totalDebtAtYearEnd - next12MonthsPrincipal,
    );

    for (let i = 1; i <= 5; i++) {
      const startOfPeriod = addYears(reportYearEnd, i - 1);
      const endOfPeriod = addYears(reportYearEnd, i);

      const periodPrincipal = result.schedule
        .filter(
          (row) =>
            isAfter(row.date, startOfPeriod) && !isAfter(row.date, endOfPeriod),
        )
        .reduce((sum, row) => sum + row.principal, 0);

      next5Years.push({
        year: getYear(endOfPeriod),
        principal: periodPrincipal,
      });
    }

    const totalThereafter = result.schedule
      .filter((row) => isAfter(row.date, addYears(reportYearEnd, 5)))
      .reduce((sum, row) => sum + row.principal, 0);

    const hasInterestOnly = initialIOMonths > 0 || specificIOMonths.length > 0;
    const ioDescription = hasInterestOnly
      ? " (subject to interest-only periods as specified in the agreement)"
      : "";

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "Financial Statement Note Disclosure (ASPE)",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              children: [
                new TextRun({ text: "Note X. Long-term Debt", bold: true }),
              ],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: `The loan, with an original principal amount of ${formatCurrency(principal)}, bears interest at a rate of ${interestRate.toFixed(2)}% per annum. The loan is repayable in monthly blended installments of ${formatCurrency(result.monthlyPayment)}${ioDescription}. The loan matures on ${format(result.schedule[result.schedule.length - 1].date, "MMMM d, yyyy")}.`,
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: `As at ${format(reportYearEnd, "MMMM d, yyyy")}, the current and long-term portions of the debt are as follows:`,
            }),
            new DocxTable({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new DocxTableRow({
                  children: [
                    new DocxTableCell({
                      children: [new Paragraph("Total long-term debt")],
                    }),
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          text: formatCurrency(totalDebtAtYearEnd),
                          alignment: AlignmentType.RIGHT,
                        }),
                      ],
                    }),
                  ],
                }),
                new DocxTableRow({
                  children: [
                    new DocxTableCell({
                      children: [new Paragraph("Less: Current portion")],
                    }),
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          text: `(${formatCurrency(next12MonthsPrincipal)})`,
                          alignment: AlignmentType.RIGHT,
                        }),
                      ],
                    }),
                  ],
                }),
                new DocxTableRow({
                  children: [
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: "Long-term portion", bold: true })],
                        }),
                      ],
                    }),
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          children: [new TextRun({ text: formatCurrency(longTermPortion), bold: true })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              children: [new TextRun({ text: "The loan is secured by [Insert Description of Collateral/Security].", italics: true, color: "666666" })],
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
              text: "Principal repayments required in each of the next five years and thereafter are as follows:",
            }),
            new Paragraph({ text: "" }),
            new DocxTable({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                ...next5Years.map(
                  (item) =>
                    new DocxTableRow({
                      children: [
                        new DocxTableCell({
                          children: [
                            new Paragraph(
                              `Year ending ${format(addYears(reportYearEnd, next5Years.indexOf(item) + 1), "MMMM d, yyyy")}`,
                            ),
                          ],
                        }),
                        new DocxTableCell({
                          children: [
                            new Paragraph({
                              text: formatCurrency(item.principal),
                              alignment: AlignmentType.RIGHT,
                            }),
                          ],
                        }),
                      ],
                    }),
                ),
                new DocxTableRow({
                  children: [
                    new DocxTableCell({
                      children: [new Paragraph("Thereafter")],
                    }),
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          text: formatCurrency(totalThereafter),
                          alignment: AlignmentType.RIGHT,
                        }),
                      ],
                    }),
                  ],
                }),
                new DocxTableRow({
                  children: [
                    new DocxTableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })] })],
                    }),
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          children: [new TextRun({ text: formatCurrency(totalDebtAtYearEnd), bold: true })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `ASPE_Disclosure_${format(new Date(), "yyyy-MM-dd")}.docx`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="space-y-6 lg:col-span-1">
        <Card className="bg-primary text-primary-foreground shadow-xl border-none overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="font-display opacity-90 text-sm uppercase tracking-wider">
              Payment Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 relative z-10">
            <div>
              <div className="text-primary-foreground/80 text-xs font-medium mb-1">
                {frequency.charAt(0).toUpperCase() + frequency.slice(1)} Payment
              </div>
              <div className="text-4xl font-display font-bold tracking-tight">
                {formatCurrency(result.monthlyPayment)}
              </div>
            </div>
            <div className="space-y-3 pt-4 border-t border-primary-foreground/20">
              <div className="flex justify-between items-center">
                <span className="text-primary-foreground/80 text-xs">
                  Balloon Payment
                </span>
                <span className="font-medium">
                  {formatCurrency(balloonPayment)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-primary-foreground/80 text-xs">
                  Total Interest
                </span>
                <span className="font-medium">
                  {formatCurrency(result.totalInterest)}
                </span>
              </div>
              <div className="flex justify-between items-center font-bold pt-3 border-t border-primary-foreground/10">
                <span className="text-primary-foreground/90">Total Cost</span>
                <span className="text-lg">
                  {formatCurrency(result.totalPayment)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-primary/10 overflow-hidden">
          <div className="h-2 w-full bg-gradient-to-r from-primary/80 to-primary"></div>
          <CardHeader className="bg-muted/30 pb-6">
            <CardTitle className="text-2xl font-display">
              Loan Parameters
            </CardTitle>
            <CardDescription>
              Configure your loan and start date
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            <div className="space-y-4">
              <Label htmlFor="startDate" className="text-base font-medium">
                Inception Date <span className="text-red-600">*</span>
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="space-y-4">
              <Label htmlFor="yearEndDate" className="text-base font-medium">
                Fiscal Year End
              </Label>
              <Input
                id="yearEndDate"
                type="date"
                value={yearEndDateStr}
                onChange={(e) => setYearEndDateStr(e.target.value)}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground italic">
                Used for Current vs. Long-term debt breakdown.
              </p>
            </div>

            <div className="space-y-4">
              <Label htmlFor="frequency" className="text-base font-medium">
                Payment Frequency
              </Label>
              <Select
                value={frequency}
                onValueChange={(v) => setFrequency(v as Frequency)}
              >
                <SelectTrigger id="frequency">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="semi-monthly">
                    Semi-Monthly (24/yr)
                  </SelectItem>
                  <SelectItem value="bi-weekly">Bi-Weekly (26/yr)</SelectItem>
                  <SelectItem value="weekly">Weekly (52/yr)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label htmlFor="balloon" className="text-base font-medium">
                  Balloon Payment
                </Label>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="number"
                    value={balloonPayment}
                    onChange={(e) => setBalloonPayment(Number(e.target.value))}
                    className="pl-7 font-display font-semibold text-lg text-primary text-right"
                    data-testid="input-balloon"
                  />
                </div>
              </div>
              <Slider
                id="balloon-slider"
                min={0}
                max={principal}
                step={1000}
                value={[balloonPayment]}
                onValueChange={(vals) => setBalloonPayment(vals[0])}
                className="py-2"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label htmlFor="principal" className="text-base font-medium">
                  Loan Amount
                </Label>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    type="number"
                    value={principal}
                    onChange={(e) => setPrincipal(Number(e.target.value))}
                    className="pl-7 font-display font-semibold text-lg text-primary text-right"
                    data-testid="input-principal"
                  />
                </div>
              </div>
              <Slider
                id="principal"
                min={10000}
                max={2000000}
                step={5000}
                value={[principal]}
                onValueChange={(vals) => setPrincipal(vals[0])}
                className="py-2"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label htmlFor="interestRate" className="text-base font-medium">
                  Interest Rate
                </Label>
                <div className="relative w-28">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    %
                  </span>
                  <Input
                    type="number"
                    step="0.1"
                    value={interestRate}
                    onChange={(e) => setInterestRate(Number(e.target.value))}
                    className="pr-8 font-display font-semibold text-lg text-primary text-right"
                    data-testid="input-interest"
                  />
                </div>
              </div>
              <Slider
                id="interestRate"
                min={0.1}
                max={15}
                step={0.1}
                value={[interestRate]}
                onValueChange={(vals) => setInterestRate(vals[0])}
                className="py-2"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label
                  htmlFor="amortizationYears"
                  className="text-base font-medium"
                >
                  Amortization Period
                </Label>
                <div className="relative w-28">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                    Yrs
                  </span>
                  <Input
                    type="number"
                    value={amortizationYears}
                    onChange={(e) =>
                      setAmortizationYears(Number(e.target.value))
                    }
                    className="pr-10 font-display font-semibold text-lg text-primary text-right"
                    data-testid="input-amortization-years"
                  />
                </div>
              </div>
              <Slider
                id="amortizationYears"
                min={1}
                max={40}
                step={1}
                value={[amortizationYears]}
                onValueChange={(vals) => setAmortizationYears(vals[0])}
                className="py-2"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <Label htmlFor="termYears" className="text-base font-medium">
                  Loan Term
                </Label>
                <div className="relative w-28">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                    Yrs
                  </span>
                  <Input
                    type="number"
                    value={termYears}
                    onChange={(e) => setTermYears(Number(e.target.value))}
                    className="pr-10 font-display font-semibold text-lg text-primary text-right"
                    data-testid="input-term-years"
                  />
                </div>
              </div>
              <Slider
                id="termYears"
                min={1}
                max={Math.min(amortizationYears, 40)}
                step={1}
                value={[termYears]}
                onValueChange={(vals) => setTermYears(vals[0])}
                className="py-2"
              />
            </div>

            <div className="pt-4 border-t space-y-4">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="show-io"
                  className="text-base font-medium cursor-pointer"
                >
                  Interest-Only Options
                </Label>
                <Checkbox
                  id="show-io"
                  checked={showIO}
                  onCheckedChange={(checked) => setShowIO(!!checked)}
                  className="h-5 w-5"
                />
              </div>

              {showIO && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <Label
                        htmlFor="io-months"
                        className="text-base font-medium"
                      >
                        Initial Interest Only Period
                      </Label>
                      <div className="relative w-28">
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                          Mo
                        </span>
                        <Input
                          type="number"
                          value={initialIOMonths}
                          onChange={(e) =>
                            setInitialIOMonths(Number(e.target.value))
                          }
                          className="pr-10 font-display font-semibold text-lg text-primary text-right"
                          data-testid="input-io-months"
                        />
                      </div>
                    </div>
                    <Slider
                      id="io-months"
                      min={0}
                      max={termYears * 12 - 1}
                      step={1}
                      value={[initialIOMonths]}
                      onValueChange={(vals) => setInitialIOMonths(vals[0])}
                      className="py-2"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-base font-medium">
                      Recurring Interest Only Months
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {MONTHS.map((month, index) => (
                        <div
                          key={month}
                          className={`flex flex-col items-center p-2 rounded-md border transition-all cursor-pointer select-none ${
                            specificIOMonths.includes(index)
                              ? "bg-primary/10 border-primary text-primary"
                              : "bg-muted/30 border-transparent hover:border-muted-foreground/30"
                          }`}
                          onClick={() => toggleSpecificMonth(index)}
                        >
                          <span className="text-[10px] font-bold uppercase">
                            {month}
                          </span>
                          <Checkbox
                            checked={specificIOMonths.includes(index)}
                            className="mt-1 h-3 w-3"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <Card className="shadow-md border-border/50 flex flex-col h-[600px]">
          <CardHeader className="pb-4 border-b flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display">
                Full Amortization Schedule
              </CardTitle>
              <CardDescription>
                Detailed monthly view from {format(startDate, "MMMM d, yyyy")}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadAmortizationPDF}
                className="gap-2"
                data-testid="button-download-pdf"
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadExcel}
                className="gap-2"
                data-testid="button-download-excel"
              >
                <Download className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadASPEDisclosure}
                className="gap-2"
                data-testid="button-download-aspe"
              >
                <FileText className="h-4 w-4" />
                ASPE Disclosure
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <div className="h-full overflow-auto rounded-b-lg">
              <Table>
                <TableHeader className="bg-muted/80 sticky top-0 z-20 backdrop-blur-md border-b">
                  <TableRow>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.schedule.map((row) => (
                    <TableRow
                      key={row.month}
                      className={row.isInterestOnly ? "bg-primary/[0.03]" : ""}
                    >
                      <TableCell className="font-medium text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{format(row.date, "MMM d, yyyy")}</span>
                          {row.isInterestOnly && (
                            <Badge
                              variant="outline"
                              className="text-[8px] px-1 h-3"
                            >
                              IO
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(row.payment)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${row.isInterestOnly ? "opacity-30" : ""}`}
                      >
                        {formatCurrency(row.principal)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.interest)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(row.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold border-t-2 sticky bottom-0 z-20 backdrop-blur-md">
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        result.schedule.reduce((sum, r) => sum + r.payment, 0),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        result.schedule.reduce(
                          (sum, r) => sum + r.principal,
                          0,
                        ),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        result.schedule.reduce((sum, r) => sum + r.interest, 0),
                      )}
                    </TableCell>
                    <TableCell className="text-right">-</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6">
          <Card className="shadow-md border-border/50">
            <CardHeader className="pb-2 border-b bg-muted/20 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg font-display">
                  Annual Breakdown
                </CardTitle>
                <CardDescription>
                  Principal and Interest totals by Fiscal Year
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadAnnualPDF}
                  className="gap-2"
                  data-testid="button-download-annual-pdf"
                >
                  <FileText className="h-4 w-4" />
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadAnnualExcel}
                  className="gap-2"
                  data-testid="button-download-annual-excel"
                >
                  <Download className="h-4 w-4" />
                  Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0">
                    <TableRow>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right font-bold">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearlyTotals.map((row) => (
                      <TableRow key={row.year}>
                        <TableCell className="font-medium">
                          {row.label}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(row.principal)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(row.interest)}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatCurrency(row.principal + row.interest)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          yearlyTotals.reduce((sum, r) => sum + r.principal, 0),
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          yearlyTotals.reduce((sum, r) => sum + r.interest, 0),
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          yearlyTotals.reduce(
                            (sum, r) => sum + r.principal + r.interest,
                            0,
                          ),
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
