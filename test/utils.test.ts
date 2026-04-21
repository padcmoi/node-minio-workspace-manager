import { describe, expect, it } from "vitest";
import { assertNamespace, joinKey, normalizePart, shQuote, slugifyBucketId } from "../src/deps/utils";
import { MinioWorkspaceError } from "../src/error";

describe("utils", () => {
  it("normalizes and joins keys", () => {
    expect(normalizePart(" /a/b/ ")).toBe("a/b");
    expect(joinKey("/a/", "b", "", "c/")).toBe("a/b/c");
  });

  it("quotes shell values safely", () => {
    expect(shQuote("abc")).toBe("'abc'");
    expect(shQuote("a'b")).toBe("'a'\\''b'");
  });

  it("validates namespaces", () => {
    expect(assertNamespace("store/files")).toBe("store/files");

    expect(() => assertNamespace("../etc")).toThrow(MinioWorkspaceError);
    expect(() => assertNamespace(" ")).toThrow(MinioWorkspaceError);
  });

  it("slugifies bucket identifiers", () => {
    expect(slugifyBucketId("Store Group ### 42")).toBe("store-group-42");
    expect(slugifyBucketId("***")).toBe("default");
  });
});
