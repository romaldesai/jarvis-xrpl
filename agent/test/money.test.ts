import { describe, expect, it } from "vitest";
import { centsToRlusd, fmtInr, fmtUsd, formatMinor, parseDecimal } from "../src/money";

describe("money (integers only)", () => {
  it("parses decimals to minor units", () => {
    expect(parseDecimal("5,000", 2)).toBe(500000n);
    expect(parseDecimal("49.99", 2)).toBe(4999n);
    expect(parseDecimal("88.123456", 6)).toBe(88123456n);
    expect(parseDecimal("1.50", 1)).toBe(15n);
  });
  it("rejects junk, negatives and excess precision", () => {
    for (const bad of ["", "-5", "1e3", "abc", "1.2.3", "0x10"]) expect(() => parseDecimal(bad, 2)).toThrow();
    expect(() => parseDecimal("1.001", 2)).toThrow();
  });
  it("formats with Indian and US grouping", () => {
    expect(fmtInr(50000000n)).toBe("₹5,00,000.00");
    expect(fmtUsd(123456789n)).toBe("$1,234,567.89");
    expect(formatMinor(5n, 2)).toBe("0.05");
  });
  it("1 cent = 10^16 RLUSD base units", () => {
    expect(centsToRlusd(5781n)).toBe(57810000000000000000n);
  });
});
