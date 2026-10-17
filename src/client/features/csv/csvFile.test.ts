import { describe, expect, it } from "vitest";
import { parseCsv } from "./csvFile";

describe("parseCsv", () => {
  it("reads what spreadsheets export: a BOM, CRLF, quoted commas and line breaks", () => {
    const text =
      '﻿Name,Domain,Notes\r\n"Acme, Inc.",acme.com,"Two\r\nlines"\r\nGlobex,globex.com,\r\n\r\n';
    expect(parseCsv(text)).toEqual({
      headers: ["Name", "Domain", "Notes"],
      rows: [
        ["Acme, Inc.", "acme.com", "Two\r\nlines"],
        ["Globex", "globex.com", ""],
      ],
    });
  });

  it("takes a file with only its header row", () => {
    expect(parseCsv("Name,Email\n")).toEqual({
      headers: ["Name", "Email"],
      rows: [],
    });
  });
});
