import type { ReportTable } from "./report-tables";

/** Header lines printed above the first table so a saved copy stands alone. */
export interface ReportDocument {
  fileName: string;
  subtitle: string[];
  tables: ReportTable[];
  title: string;
}

const MARGIN = 40;
const TITLE_SIZE = 14;
const TEXT_SIZE = 9;
const LINE_HEIGHT = 14;
const EXCEL_SHEET_NAME_MAX = 31;

/** XLSX: one sheet per table, plus the header lines in the first rows of each sheet. Loaded on demand. */
export async function exportXlsx(report: ReportDocument): Promise<void> {
  const { utils, writeFile } = await import("xlsx");
  const book = utils.book_new();
  for (const table of report.tables) {
    const sheet = utils.aoa_to_sheet([
      [report.title],
      ...report.subtitle.map((line) => [line]),
      [],
      table.head,
      ...table.body,
    ]);
    utils.book_append_sheet(book, sheet, table.name.slice(0, EXCEL_SHEET_NAME_MAX));
  }
  writeFile(book, report.fileName);
}

/** PDF (landscape A4): title block, then each table on its own page. Loaded on demand. */
export async function exportPdf(report: ReportDocument): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
  for (const [index, table] of report.tables.entries()) {
    if (index > 0) {
      doc.addPage();
    }
    doc.setFontSize(TITLE_SIZE);
    doc.text(`${report.title} — ${table.name}`, MARGIN, MARGIN);
    doc.setFontSize(TEXT_SIZE);
    for (const [line, text] of report.subtitle.entries()) {
      doc.text(text, MARGIN, MARGIN + LINE_HEIGHT * (line + 1));
    }
    autoTable(doc, {
      body: table.body,
      head: [table.head],
      margin: { left: MARGIN, right: MARGIN },
      startY: MARGIN + LINE_HEIGHT * (report.subtitle.length + 2),
      styles: { fontSize: TEXT_SIZE - 1 },
    });
  }
  doc.save(report.fileName);
}
