import { fromBuffer } from "yauzl";
import { XMLParser } from "fast-xml-parser";
import { KnowledgeError, type Passage } from "./validation";
import { cleanText } from "./chunking";

async function docxXml(bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new KnowledgeError("The DOCX file is invalid or encrypted."));
      let total = 0; let count = 0; let xml = "";
      const fail = () => { zip.close(); reject(new KnowledgeError("The DOCX is invalid or exceeds safe extraction limits.")); };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        total += entry.uncompressedSize;
        if (++count > 1000 || total > 20 * 1024 * 1024 || entry.isEncrypted()) return fail();
        if (entry.fileName !== "word/document.xml") return zip.readEntry();
        if (entry.uncompressedSize > 4 * 1024 * 1024 || xml) return fail();
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail();
          const parts: Buffer[] = []; let size = 0;
          stream.on("data", (part: Buffer) => { size += part.length; if (size > 4 * 1024 * 1024) { stream.destroy(); fail(); } else parts.push(part); });
          stream.on("error", fail);
          stream.on("end", () => { xml = Buffer.concat(parts).toString("utf8"); zip.readEntry(); });
        });
      });
      zip.on("end", () => xml ? resolve(xml) : reject(new KnowledgeError("This DOCX has no document text.")));
      zip.readEntry();
    });
  });
}
// Ordered XML nodes preserve paragraph/run order; no HTML is rendered or external relationships followed.
type XmlNode = Record<string, unknown>;
function textOf(nodes: XmlNode[]): string {
  return nodes.map((node) => Object.entries(node).map(([key, value]) => {
    if (key === "#text") return String(value);
    if (key === "w:tab") return " ";
    if (key === "w:br") return "\n";
    return Array.isArray(value) ? textOf(value) : "";
  }).join("")).join("");
}
function paragraphs(nodes: XmlNode[], output: { text: string; heading: boolean }[]) {
  for (const node of nodes) for (const [key, value] of Object.entries(node)) {
    if (!Array.isArray(value)) continue;
    if (key === "w:p") {
      const properties = value.find((child: XmlNode) => "w:pPr" in child)?.["w:pPr"];
      const style = Array.isArray(properties) ? properties.find((child: XmlNode) => "w:pStyle" in child) : null;
      const attributes = style?.[":@"] as Record<string, unknown> | undefined;
      output.push({ text: cleanText(textOf(value)), heading: /^heading[1-9]$/i.test(String(attributes?.["@_w:val"] ?? "")) });
    } else paragraphs(value, output);
  }
}
export async function extractDocument(bytes: Buffer, mime: string): Promise<Passage[]> {
  let passages: Passage[] = [];
  if (mime === "application/pdf") {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new KnowledgeError("The PDF file signature is invalid.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new KnowledgeError("PDFs must contain 100 pages or fewer.");
      let chars = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        const data = await (await pdf.getPage(page)).getTextContent();
        const content = cleanText(data.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
        chars += content.length;
        if (chars > 1_000_000) throw new KnowledgeError("The PDF contains too much text. Split it into smaller files.");
        if (content) passages.push({ content, page_number: page, section_title: null });
      }
      if (!passages.length) throw new KnowledgeError("This PDF has no selectable text. Scanned PDFs and OCR are not supported yet.");
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      throw new KnowledgeError("PDF extraction failed. Use an unencrypted PDF with selectable text.");
    } finally { await task.destroy(); }
  } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const xml = await docxXml(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new KnowledgeError("DOCX files with custom XML entities are unsupported.");
    let nodes: XmlNode[];
    try { nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(xml) as XmlNode[]; }
    catch { throw new KnowledgeError("DOCX extraction failed. Export a fresh DOCX or a plain-text document and retry."); }
    const rows: { text: string; heading: boolean }[] = [];
    paragraphs(nodes, rows);
    let title: string | null = null; let content: string[] = [];
    const flush = () => { if (content.length) passages.push({ content: content.join("\n\n"), page_number: null, section_title: title }); content = []; };
    for (const row of rows) if (row.text) { if (row.heading) { flush(); title = row.text.slice(0, 250); } content.push(row.text); }
    flush();
  } else {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new KnowledgeError("Text documents must use UTF-8 encoding."); }
    if (text.includes("\0")) throw new KnowledgeError("The file contains binary data, not plain text.");
    let title: string | null = null; let lines: string[] = [];
    const flush = () => { if (lines.length) passages.push({ content: lines.join("\n"), page_number: null, section_title: title }); lines = []; };
    for (const line of text.split(/\r?\n/)) { if (mime === "text/markdown" && /^#{1,6}\s+/.test(line)) { flush(); title = line.replace(/^#+\s+/, "").slice(0, 250); } lines.push(line); }
    flush();
  }
  passages = passages.map((p) => ({ ...p, content: cleanText(p.content) })).filter((p) => p.content);
  if (!passages.length) throw new KnowledgeError("The document is empty or has no extractable text.");
  if (passages.reduce((sum, p) => sum + p.content.length, 0) > 1_000_000) throw new KnowledgeError("The document contains too much text. Split it into smaller files.");
  return passages;
}
