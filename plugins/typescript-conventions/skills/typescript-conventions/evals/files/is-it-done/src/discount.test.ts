import { describe, expect, it } from "vitest";
import { applyDiscount, bestDiscount } from "./discount.js";

describe("applyDiscount", () => {
  it("takes ten percent off", () => {
    expect(applyDiscount(1000, 10)).toBe(900);
  });

  it("rounds half pence up", () => {
    expect(applyDiscount(999, 50)).toBe(500);
  });
});

describe("bestDiscount", () => {
  it("matches snapshot", () => {
    expect(bestDiscount([5, 20, 10])).toMatchSnapshot();
  });
});
