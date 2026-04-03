import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeUrl } from "./sanitize.js";

describe("escapeHtml", () => {
  it("escapes key HTML characters", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });
});

describe("sanitizeUrl", () => {
  it("accepts http/https URLs", () => {
    expect(sanitizeUrl("https://example.com/path")).toBe(
      "https://example.com/path"
    );
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects unsafe protocols", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html;base64,AAAA")).toBeNull();
  });
});

