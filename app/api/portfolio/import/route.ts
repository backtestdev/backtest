import { NextRequest, NextResponse } from "next/server";
import { parseCSVFile } from "@/lib/csvParser";
import type { ImportedHolding, ImportResult } from "@/lib/csvParser";

export const dynamic = "force-dynamic";

// Max file size: 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;

async function fileToCSVText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    // Dynamic import to avoid bundling xlsx when not needed
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(firstSheet);
  }

  // CSV - read as text
  return await file.text();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files: File[] = [];

    // Collect all uploaded files
    formData.forEach((value, key) => {
      if (key === "files" && value instanceof File) {
        files.push(value);
      }
    });

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES} files allowed.` },
        { status: 400 }
      );
    }

    // Validate files
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds 10 MB limit.` },
          { status: 400 }
        );
      }
      const name = file.name.toLowerCase();
      if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        return NextResponse.json(
          { error: `File "${file.name}" is not a CSV or XLSX file.` },
          { status: 400 }
        );
      }
    }

    // Parse each file
    const allHoldings: ImportedHolding[] = [];
    const allWarnings: string[] = [];
    const allBrokers = new Set<string>();
    const allAccounts = new Set<string>();
    let totalSkipped = 0;

    for (const file of files) {
      try {
        const csvText = await fileToCSVText(file);

        // IBKR special handling: the CSV might have a BOM
        const cleanedText = csvText.replace(/^\uFEFF/, "");

        const result: ImportResult = parseCSVFile(cleanedText, file.name);

        allHoldings.push(...result.holdings);
        for (const w of result.warnings) {
          allWarnings.push(`[${file.name}] ${w}`);
        }
        for (const b of result.summary.brokersDetected) {
          allBrokers.add(b);
        }
        for (const a of result.summary.accountsDetected) {
          allAccounts.add(a);
        }
        totalSkipped += result.summary.skippedRows;
      } catch (fileErr) {
        console.error(`Error parsing ${file.name}:`, fileErr);
        allWarnings.push(`[${file.name}] Failed to parse file.`);
      }
    }

    // Compute total value
    let totalValue = 0;
    for (const h of allHoldings) {
      totalValue += h.currentValue;
    }

    return NextResponse.json({
      holdings: allHoldings,
      warnings: allWarnings,
      summary: {
        totalHoldings: allHoldings.length,
        totalValue,
        accountsDetected: Array.from(allAccounts),
        brokersDetected: Array.from(allBrokers),
        skippedRows: totalSkipped,
      },
    });
  } catch (error) {
    console.error("Portfolio import error:", error);
    return NextResponse.json({ error: "Failed to import portfolio data" }, { status: 500 });
  }
}
