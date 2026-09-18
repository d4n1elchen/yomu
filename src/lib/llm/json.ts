/**
 * The first complete JSON object or array in a reply, or null.
 *
 * glm-5.3-flash:cloud honours a JSON schema and then keeps talking: a valid
 * object, a blank line, and an explanation in prose after it -- measured on the
 * grammar prompt. The object is the answer; the rest would make a whole-reply
 * `JSON.parse` fail and throw the answer away with it. Strings are skipped
 * whole, so a brace inside a gloss does not end the object early.
 */
export function leadingJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
