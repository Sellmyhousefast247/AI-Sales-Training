/**
 * Best-effort parser for free-form US addresses. Handles the common
 * paste shapes:
 *   "123 Main St, San Antonio, TX 78230"
 *   "123 Main St San Antonio TX 78230"
 *   "123 Main St, San Antonio, TX, 78230"
 *
 * Returns the original full string in `address` if we can't separate
 * the parts — the comping API still accepts that and lets the
 * provider geocoder figure it out.
 */
export interface ParsedAddress {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}

const STATE_REGEX = /\b([A-Z]{2})\b/;
const ZIP_REGEX = /\b(\d{5}(?:-\d{4})?)\b/;

export function parseAddress(input: string): ParsedAddress {
  const raw = input.trim().replace(/\s+/g, " ");
  if (!raw) return { address: "" };

  // Comma-separated form is the most reliable.
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 3) {
    const tail = parts.slice(2).join(" ");
    const stateMatch = tail.match(STATE_REGEX);
    const zipMatch = tail.match(ZIP_REGEX);
    return {
      address: parts[0],
      city: parts[1],
      state: stateMatch?.[1],
      zip: zipMatch?.[1],
    };
  }

  // No commas — try regexes from the right edge.
  const zipMatch = raw.match(ZIP_REGEX);
  const upTo = zipMatch ? raw.slice(0, zipMatch.index).trim() : raw;
  const stateMatch = upTo.match(/\b([A-Z]{2})\s*$/);
  if (stateMatch && zipMatch) {
    const beforeState = upTo.slice(0, stateMatch.index).trim();
    // City = last token group before the state code.
    const cityIdx = beforeState.lastIndexOf(" ");
    if (cityIdx > 0) {
      return {
        address: beforeState.slice(0, cityIdx).trim(),
        city: beforeState.slice(cityIdx + 1).trim(),
        state: stateMatch[1],
        zip: zipMatch[1],
      };
    }
  }

  return { address: raw };
}
