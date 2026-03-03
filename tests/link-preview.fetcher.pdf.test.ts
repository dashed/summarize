import { describe, expect, it, vi } from "vitest";
import {
  fetchPdfText,
  isPdfContentTypeError,
} from "../packages/core/src/content/link-preview/content/fetcher.js";

// Minimal valid PDF with "Hello PDF" text
const MINIMAL_PDF = `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000340 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
434
%%EOF`;

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode(MINIMAL_PDF);
}

describe("isPdfContentTypeError", () => {
  it("returns true for PDF content-type errors", () => {
    expect(
      isPdfContentTypeError(
        new Error("Unsupported content-type for HTML document fetch: application/pdf"),
      ),
    ).toBe(true);
  });

  it("returns true when content-type has charset suffix", () => {
    expect(
      isPdfContentTypeError(
        new Error("Unsupported content-type for HTML document fetch: application/pdf; charset=utf-8"),
      ),
    ).toBe(true);
  });

  it("returns false for non-PDF errors", () => {
    expect(isPdfContentTypeError(new Error("Failed to fetch HTML document (status 403)"))).toBe(
      false,
    );
  });

  it("returns false for non-Error values", () => {
    expect(isPdfContentTypeError("application/pdf")).toBe(false);
    expect(isPdfContentTypeError(null)).toBe(false);
    expect(isPdfContentTypeError(undefined)).toBe(false);
  });
});

describe("fetchPdfText", () => {
  it("extracts text from a valid PDF response", async () => {
    const bytes = pdfBytes();
    const fetchMock = vi.fn(async () => {
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });

    const result = await fetchPdfText(fetchMock as unknown as typeof fetch, "https://example.com/doc.pdf");
    expect(result.text).toContain("Hello PDF");
    expect(result.finalUrl).toBe("https://example.com/doc.pdf");
  });

  it("throws on non-OK response", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/html" } });
    });

    await expect(
      fetchPdfText(fetchMock as unknown as typeof fetch, "https://example.com/missing.pdf"),
    ).rejects.toThrow(/status 404/);
  });

  it("throws for invalid PDF data", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("not a real PDF", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });

    await expect(
      fetchPdfText(fetchMock as unknown as typeof fetch, "https://example.com/bad.pdf"),
    ).rejects.toThrow();
  });

  it("throws for empty text extraction", async () => {
    // A PDF that parses but has no text content — use a mock approach
    // by testing the empty-text check with a tiny valid PDF
    const emptyPdf = new TextEncoder().encode(
      `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
206
%%EOF`,
    );
    const fetchMock = vi.fn(async () => {
      return new Response(emptyPdf, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });

    await expect(
      fetchPdfText(fetchMock as unknown as typeof fetch, "https://example.com/empty.pdf"),
    ).rejects.toThrow(/no extractable text/);
  });

  it("reports progress events", async () => {
    const bytes = pdfBytes();
    const fetchMock = vi.fn(async () => {
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });

    const events: Array<{ kind: string }> = [];
    await fetchPdfText(fetchMock as unknown as typeof fetch, "https://example.com/doc.pdf", {
      onProgress: (e) => events.push(e as { kind: string }),
    });

    expect(events.some((e) => e.kind === "fetch-html-start")).toBe(true);
    expect(events.some((e) => e.kind === "fetch-html-done")).toBe(true);
  });

  it("throws timeout error when fetch is aborted", async () => {
    const abortingFetch = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      fetchPdfText(abortingFetch as unknown as typeof fetch, "https://example.com/slow.pdf", {
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
