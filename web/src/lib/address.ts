import { getAddress, isAddress, zeroAddress, type Address } from "viem";

// whitespace plus the invisible characters that ride along when copying from chats and docs:
// zero-width space/joiners, LRM/RLM, bidi embeddings, word joiner, BOM
const INVISIBLE = /[\s​-‏‪-‮⁠-⁤﻿]/g;

/** What the input keeps while typing: no whitespace or invisible characters, no wrapping quotes/brackets, lowercase "0x". */
export function cleanAddress(raw: string): string {
  return raw.replace(INVISIBLE, "").replace(/^["'`<(\[]+|["'`>)\]]+$/g, "").replace(/^0X/, "0x");
}

/** A checksummed address, or null. Any letter case is accepted (strict: false); the zero address is not. */
export function parseAddress(raw: string): Address | null {
  const c = cleanAddress(raw);
  if (!isAddress(c, { strict: false }) || c.toLowerCase() === zeroAddress) return null;
  return getAddress(c);
}
