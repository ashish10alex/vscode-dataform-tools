/** Characters that separate the words of a table, dataset or project name */
const SEPARATOR = /[._-]/;

/** True when `index` in `text` falls between two words: at either end, or next to a separator */
function atWordBoundary(text: string, index: number): boolean {
  return index === 0 || index === text.length || SEPARATOR.test(text[index - 1]) || SEPARATOR.test(text[index]);
}

export interface NameDiff {
  /** Text both names start with */
  prefix: string;
  /** The part only the first name has, e.g. the `AA_` table prefix of a dev name */
  before: string;
  /** The part only the second name has */
  after: string;
  /** Text both names end with */
  suffix: string;
}

/**
 * How two names differ, like a word diff: the shared start and end, and the part in between that differs.
 * The differing part is widened to whole words, so `sales_v2` and `sales_v3` differ in `v2` and `v3` rather than
 * in `2` and `3`. Equal names differ in nothing.
 */
export function diffNames(a: string, b: string): NameDiff {
  // The shared end is matched first, as table prefixes are the usual difference: `AA_A_TABLE` and `A_TABLE` share `A_TABLE`
  let suffix = 0;
  while (suffix < a.length && suffix < b.length && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix++;
  }
  let prefix = 0;
  while (prefix < a.length - suffix && prefix < b.length - suffix && a[prefix] === b[prefix]) {
    prefix++;
  }
  while (prefix > 0 && !(atWordBoundary(a, prefix) && atWordBoundary(b, prefix))) {
    prefix--;
  }
  while (suffix > 0 && !(atWordBoundary(a, a.length - suffix) && atWordBoundary(b, b.length - suffix))) {
    suffix--;
  }
  return {
    prefix: a.slice(0, prefix),
    before: a.slice(prefix, a.length - suffix),
    after: b.slice(prefix, b.length - suffix),
    suffix: a.slice(a.length - suffix),
  };
}
