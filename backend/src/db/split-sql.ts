export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];

  let buf = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let dollarDelim: string | null = null; // e.g. "$$" or "$tag$"

  function push() {
    const s = buf.trim();
    if (s.length > 0) out.push(s);
    buf = "";
  }

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = i + 1 < sql.length ? sql[i + 1]! : "";

    // Line comments: -- ... \n
    if (!inSingle && !inDouble && dollarDelim === null && ch === "-" && next === "-") {
      // Skip until newline (but keep newline to preserve statement boundaries)
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // Block comments: /* ... */
    if (!inSingle && !inDouble && dollarDelim === null && ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2; // skip closing */
      continue;
    }

    // Dollar-quoted blocks: $tag$ ... $tag$
    if (!inSingle && !inDouble) {
      if (dollarDelim === null && ch === "$") {
        // Try to parse delimiter.
        let j = i + 1;
        while (j < sql.length) {
          const c = sql[j]!;
          if (c === "$") break;
          // Delimiter tags are limited; keep it permissive.
          if (!/[A-Za-z0-9_]/.test(c)) {
            j = -1;
            break;
          }
          j++;
        }
        if (j !== -1 && j < sql.length && sql[j] === "$") {
          dollarDelim = sql.slice(i, j + 1); // includes both $'s
          buf += dollarDelim;
          i = j + 1;
          continue;
        }
      } else if (dollarDelim !== null) {
        if (sql.startsWith(dollarDelim, i)) {
          buf += dollarDelim;
          i += dollarDelim.length;
          dollarDelim = null;
          continue;
        }
      }
    }

    // String literals
    if (dollarDelim === null && !inDouble && ch === "'") {
      buf += ch;
      if (inSingle) {
        // Escape: '' inside a string
        if (next === "'") {
          buf += next;
          i += 2;
          continue;
        }
        inSingle = false;
      } else {
        inSingle = true;
      }
      i += 1;
      continue;
    }

    // Quoted identifiers
    if (dollarDelim === null && !inSingle && ch === "\"") {
      buf += ch;
      if (inDouble) {
        // Escape: "" inside an identifier
        if (next === "\"") {
          buf += next;
          i += 2;
          continue;
        }
        inDouble = false;
      } else {
        inDouble = true;
      }
      i += 1;
      continue;
    }

    // Statement terminator
    if (!inSingle && !inDouble && dollarDelim === null && ch === ";") {
      push();
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  push();
  return out;
}

