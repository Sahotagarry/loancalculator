import { jsPDF } from "jspdf";
import { __createTable, __drawTable, type UserOptions } from "jspdf-autotable";

export type Orientation = "portrait" | "landscape";
export interface PrintIdentity {
  title: string;
  subject: string;
  period?: string;
  clientName?: string;
}
type Cell = string | number;
export interface PrintTable {
  title: string;
  head: string[];
  rows: Cell[][];
  foot?: Cell[][];
  notes?: string[];
  /** Relative column widths. All widths use the actual printable page area. */
  widths?: number[];
  right?: number[];
}
const inset = 15,
  bottom = 21;
// Standard PDF fonts encode typographic dashes, but not mathematical minus/comparison glyphs.
const printable = (v: Cell) =>
  String(v)
    .replaceAll("−", "-")
    .replaceAll("≥", ">=")
    .replaceAll("≤", "<=")
    .replaceAll("→", "->")
    .replaceAll("\u202f", " ");

/** Letter-paper flow shared only by PDF downloads. Coordinates are in mm. */
export class PrintReport {
  readonly doc: jsPDF;
  private top = 0;
  private y = 0;
  private headerLines: string[] = [];
  private decorated = new Set<number>();

  constructor(
    private identity: PrintIdentity,
    private orientation: Orientation = "portrait",
  ) {
    this.doc = new jsPDF({ format: "letter", orientation, compress: true });
    this.doc.setProperties({
      title: `${identity.title} — ${identity.subject}`,
    });
    this.layoutHeader();
  }
  private get width() {
    return this.doc.internal.pageSize.getWidth() - 2 * inset;
  }
  private get height() {
    return this.doc.internal.pageSize.getHeight();
  }
  private font(size: number, bold = false) {
    this.doc
      .setFont("helvetica", bold ? "bold" : "normal")
      .setFontSize(size)
      .setTextColor(34);
  }
  private layoutHeader() {
    this.font(10, !!this.identity.clientName);
    const subject = this.identity.clientName ? [
      `Client name: ${this.identity.clientName}`,
      this.identity.period ? `Year-end: ${this.identity.period.replace(/^(?:Year ended|Reporting year-end:)\s*/i, "")}` : "",
      ...this.identity.subject.split("\n").filter(line => line !== this.identity.clientName),
    ].filter(Boolean).join("\n") : this.identity.subject;
    const full: string[] = this.doc.splitTextToSize(
      printable(subject),
      this.width,
    );
    // Exceptionally long legal names must not consume the entire running header.
    this.headerLines =
      full.length <= 5
        ? full
        : [...full.slice(0, 4), "(full identification at start of section)"];
    this.top = 28 + this.headerLines.length * 4.5;
    this.y = this.top;
    this.decoratePage();
    if (full.length > 5) this.paragraph(subject);
  }
  private decoratePage() {
    const page = this.doc.getCurrentPageInfo().pageNumber;
    if (this.decorated.has(page)) return;
    this.decorated.add(page);
    this.font(16, true);
    this.doc.text(this.identity.title, inset, 17);
    this.font(10, !!this.identity.clientName);
    this.headerLines.forEach((line, i) =>
      this.doc.text(line, inset, 23 + 4.5 * i),
    );
    this.doc
      .setDrawColor(95)
      .setLineWidth(0.32)
      .line(inset, this.top - 4, inset + this.width, this.top - 4);
    this.doc
      .setDrawColor(155)
      .setLineWidth(0.2)
      .line(inset, this.height - 16, inset + this.width, this.height - 16);
    this.font(9);
    if (this.identity.period)
      this.doc.text(printable(this.identity.period), inset, this.height - 10);
  }
  newPart(identity: PrintIdentity, orientation: Orientation) {
    this.identity = identity;
    this.orientation = orientation;
    this.doc.addPage("letter", orientation);
    this.layoutHeader();
  }
  private nextPage() {
    this.doc.addPage("letter", this.orientation);
    this.y = this.top;
    this.decoratePage();
  }
  paragraph(text: string, size = 10) {
    this.font(size);
    const lines: string[] = this.doc.splitTextToSize(
      printable(text),
      this.width - 1,
    );
    const lineHeight = (size * 1.35) / this.doc.internal.scaleFactor;
    if (
      lines.length <= 4 &&
      this.y + lines.length * lineHeight > this.height - bottom
    )
      this.nextPage();
    for (const line of lines) {
      if (this.y + lineHeight > this.height - bottom) this.nextPage();
      this.font(size);
      this.doc.text(line, inset, this.y + lineHeight * 0.77);
      this.y += lineHeight;
    }
    this.y += 3;
  }
  table({ title, head, rows, foot, notes, widths, right = [] }: PrintTable) {
    const widthSum = widths?.reduce((a, b) => a + b, 0) ?? 1;
    const titleCell = {
      content: printable(title),
      colSpan: head.length,
      styles: {
        fontSize: 12,
        textColor: 28,
        fillColor: 255,
        halign: "left" as const,
        cellPadding: { top: 1, bottom: 2, left: 0, right: 0 },
      },
    };
    const options: UserOptions = {
      startY: this.y,
      margin: { left: inset, right: inset, top: this.top, bottom },
      theme: "plain",
      head: [[titleCell], head.map(printable)],
      body: [
        ...rows.map((r) => r.map(printable)),
        ...(notes ?? []).map((note) => [
          {
            content: printable(note),
            colSpan: head.length,
            styles: {
              fillColor: 255,
              fontStyle: "italic" as const,
              halign: "left" as const,
            },
          },
        ]),
      ],
      foot: foot?.map((r) => r.map(printable)),
      showHead: "everyPage",
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      styles: {
        font: "helvetica",
        fontSize: 9.5,
        cellPadding: 1.65,
        textColor: 30,
        valign: "top",
        overflow: "linebreak",
      },
      headStyles: {
        fontStyle: "bold",
        fontSize: 9,
        textColor: 22,
        fillColor: 224,
      },
      alternateRowStyles: { fillColor: 247 },
      footStyles: { fontStyle: "bold", textColor: 22, fillColor: 231 },
      columnStyles: Object.fromEntries(
        (widths ?? []).map((w, i) => [
          i,
          { cellWidth: (this.width * w) / widthSum },
        ]),
      ),
      didParseCell: ({ cell, column, section, row }) => {
        if (
          (right.includes(column.index) ||
            (section === "body" &&
              /^\(?-?\$[\d,]+\.\d{2}\)?$/.test(cell.text.join("")))) &&
          !(section === "head" && row.index === 0) &&
          cell.colSpan === 1
        )
          cell.styles.halign = "right";
      },
      willDrawPage: () => this.decoratePage(),
    };
    // Use the library's *wrapped* geometry, not row counts. Never strand the
    // section heading + column labels on a page without the first detail row.
    const table = __createTable(this.doc, options);
    const headers = table.getHeadHeight(table.columns),
      totals = table.getFootHeight(table.columns);
    const room = this.height - bottom - this.top - headers - totals;
    const first = table.body[0]?.height ?? 0;
    const needed =
      headers +
      (first > room ? 15 : first) +
      (table.body.length <= 1 ? totals : 0);
    if (
      this.y > this.top &&
      this.height - bottom - this.y < Math.max(needed, headers + totals)
    )
      this.nextPage();
    table.settings.startY = this.y;
    __drawTable(this.doc, table);
    this.y = table.finalY! + 4;
  }
  finish() {
    const pages = this.doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      this.doc.setPage(page);
      this.font(9);
      this.doc.text(
        `Page ${page} of ${pages}`,
        inset + this.width,
        this.height - 10,
        { align: "right" },
      );
    }
    return this.doc;
  }
}
