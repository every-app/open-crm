import Papa from "papaparse";

// Reading a CSV a person picked, in the browser: spreadsheets export with a
// byte order mark, Windows line endings, quoted commas and line breaks
// inside cells, and trailing blank lines, and any of them can come in.

export type ParsedCsv = {
  /** The header row, each trimmed; a blank one is named by its position. */
  headers: string[];
  /** The rows under it, each as long as the header row. */
  rows: string[][];
};

/** The file's header and rows; blank lines are dropped. */
export function parseCsv(text: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    skipEmptyLines: "greedy",
  });
  const [header = [], ...rows] = parsed.data;
  const headers = header.map(
    (name, index) => name.trim() || `Column ${index + 1}`,
  );
  return {
    headers,
    rows: rows.map((row) =>
      headers.map((_, index) => (row[index] ?? "").trim()),
    ),
  };
}
