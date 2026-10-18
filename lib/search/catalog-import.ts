import { normalizePriceToCents } from "@/lib/search/normalize";
import { catalogItemFromSecondhand, secondhandItemInputSchema, type CatalogItem } from "@/lib/search/catalog";

/**
 * Bulk import of hand-picked items from a CSV with a header row:
 *   title,category,price,url,store,image_url,condition,source,added_by
 * `price` is in dollars ("$24.99"). `source` defaults to "manual", `condition` to "new" for manual rows.
 */

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export interface ImportResult {
  items: CatalogItem[];
  errors: { line: number; message: string }[];
}

export function catalogItemsFromCsv(text: string, now: Date): ImportResult {
  const [header = [], ...rows] = parseCsv(text);
  const columns = header.map((name) => name.trim().toLowerCase());
  const items: CatalogItem[] = [];
  const errors: ImportResult["errors"] = [];
  rows.forEach((cells, index) => {
    const line = index + 2;
    const cell = (name: string) => {
      const value = cells[columns.indexOf(name)]?.trim();
      return value ? value : undefined;
    };
    const source = cell("source") ?? "manual";
    try {
      const input = secondhandItemInputSchema.parse({
        title: cell("title"),
        category: cell("category"),
        priceCents: normalizePriceToCents(cell("price") ?? ""),
        url: cell("url"),
        store: cell("store"),
        imageUrl: cell("image_url"),
        condition: cell("condition") ?? (source === "manual" ? "new" : "used"),
        source,
        addedBy: cell("added_by"),
      });
      items.push(catalogItemFromSecondhand(input, now));
    } catch (error) {
      const issues = error instanceof Error && "issues" in error && Array.isArray(error.issues) ? error.issues : null;
      const message = issues
        ? issues.map((issue: { path?: unknown[]; message?: string }) => `${issue.path?.join(".") || "row"}: ${issue.message}`).join("; ")
        : String(error);
      errors.push({ line, message });
    }
  });
  return { items, errors };
}
