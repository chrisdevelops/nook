export type TableCellAlign = "left" | "right";

export type RenderTableOptions = {
  readonly aligns?: readonly TableCellAlign[];
  readonly separator?: string;
};

const DEFAULT_SEPARATOR = "  ";

const cellWidth = (cell: string): number => Bun.stringWidth(cell);

const padCell = (cell: string, width: number, align: TableCellAlign): string => {
  const padding = " ".repeat(Math.max(0, width - cellWidth(cell)));
  return align === "right" ? `${padding}${cell}` : `${cell}${padding}`;
};

export const renderTable = (
  rows: readonly (readonly string[])[],
  options: RenderTableOptions = {},
): string => {
  if (rows.length === 0) {
    return "";
  }

  const columnCount = rows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );

  const widths = new Array<number>(columnCount).fill(0);
  for (const row of rows) {
    for (let index = 0; index < columnCount; index += 1) {
      const cell = row[index] ?? "";
      const width = cellWidth(cell);
      if (width > (widths[index] ?? 0)) {
        widths[index] = width;
      }
    }
  }

  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const aligns = options.aligns ?? [];

  const lines = rows.map((row) => {
    const cells: string[] = [];
    for (let index = 0; index < columnCount; index += 1) {
      const cell = row[index] ?? "";
      const align: TableCellAlign = aligns[index] ?? "left";
      cells.push(padCell(cell, widths[index] ?? 0, align));
    }
    return cells.join(separator);
  });

  return `${lines.join("\n")}\n`;
};
