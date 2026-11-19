import { style } from './text.ts';

export type EntryType = 'dir' | 'file';

/** Eintrag für ls. */
export interface DirEntry {
  name: string;
  type: EntryType;
  /** Größe in Bytes (Dateien). */
  size: number;
  /** Letzte Änderung, ISO-8601. */
  mtime: string;
}

/** Knoten für tree. */
export interface TreeNode {
  name: string;
  type: EntryType;
  children?: TreeNode[];
}

/** Ab dieser Breite gibt es die ausführlichen Varianten. */
const NARROW_COLS = 48;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c‎‏‪-‮⁦-⁩]/g;

/** Namen, Inhalte und Eingaben nie ungeprüft ins Terminal schreiben (Terminal-Injection). */
export const clean = (s: string): string => s.replace(CONTROL, '');

export function formatSize(bytes: number): string {
  if (bytes < 1000) return String(bytes);
  const units = ['K', 'M', 'G'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const colorName = (e: DirEntry): string =>
  e.type === 'dir' ? style.bold(style.blue(clean(e.name))) : clean(e.name);

/** `ls`: Spalten (kurz) oder Tabelle (-l), mit schmaler Variante. */
export function formatLs(entries: readonly DirEntry[], long: boolean, cols: number): string[] {
  if (entries.length === 0) return [];
  if (long) {
    const sizes = entries.map((e) => (e.type === 'dir' ? '-' : formatSize(e.size)));
    const sizeWidth = Math.max(...sizes.map((s) => s.length));
    const narrow = cols < NARROW_COLS;
    return entries.map((e, i) => {
      const size = sizes[i]!.padStart(sizeWidth);
      if (narrow) return `${e.type === 'dir' ? 'd' : '-'} ${size}  ${colorName(e)}`;
      const mode = e.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
      return `${mode}  ${size}  ${formatDate(e.mtime)}  ${colorName(e)}`;
    });
  }

  // Kurz: spaltenweise sortiert wie bei ls, jede Spalte so breit wie ihr längster Name.
  const names = entries.map((e) => clean(e.name));
  const GAP = 2;
  for (let rows = 1; rows <= names.length; rows++) {
    const columns = Math.ceil(names.length / rows);
    const widths = Array.from({ length: columns }, (_, c) =>
      Math.max(...names.slice(c * rows, (c + 1) * rows).map((n) => n.length)),
    );
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (columns - 1);
    if (total > cols && rows < names.length) continue;
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < columns; c++) {
        const i = c * rows + r;
        if (i >= names.length) continue;
        const isLast = c === columns - 1 || (c + 1) * rows + r >= names.length;
        line +=
          colorName(entries[i]!) + (isLast ? '' : ' '.repeat(widths[c]! - names[i]!.length + GAP));
      }
      lines.push(line);
    }
    return lines;
  }
  return [];
}

/** `tree`: Baum mit Linien; schmal mit kürzeren Einrückungen. */
export function formatTree(
  root: TreeNode,
  dirs: number,
  files: number,
  truncated: boolean,
  cols: number,
): string[] {
  const narrow = cols < NARROW_COLS;
  const [tee, last, pipe, gap] = narrow
    ? ['├ ', '└ ', '│ ', '  ']
    : ['├── ', '└── ', '│   ', '    '];
  const lines = [style.bold(style.blue(clean(root.name)))];
  const walk = (nodes: readonly TreeNode[], prefix: string): void => {
    nodes.forEach((node, i) => {
      const end = i === nodes.length - 1;
      const name =
        node.type === 'dir' ? style.bold(style.blue(clean(node.name))) : clean(node.name);
      lines.push(`${style.dim(prefix + (end ? last : tee))}${name}`);
      if (node.children) walk(node.children, prefix + (end ? gap : pipe));
    });
  };
  walk(root.children ?? [], '');
  lines.push('', `${dirs} Ordner, ${files} ${files === 1 ? 'Datei' : 'Dateien'}`);
  if (truncated) lines.push(style.yellow('Ausgabe gekürzt.'));
  return lines;
}

/** `cat`: Zeilen aufteilen, Tabs auf Leerzeichen, Steuerzeichen raus. */
export function formatCat(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((l) => clean(l.replace(/\t/g, '   ')));
}
