import { describe, test, expect } from "vitest";
import {
  formatCommentForAdo,
  buildCommentMarker,
  extractCommentMarker,
} from "../src/comments.js";

describe("formatCommentForAdo", () => {
  test("formats a simple comment with attribution", () => {
    const result = formatCommentForAdo("Let's plan this for Q4", "octocat");
    expect(result).toBe("Let's plan this for Q4\n\n— @octocat via copy-over");
  });

  test("trims whitespace from comment body", () => {
    const result = formatCommentForAdo("  hello world  ", "user1");
    expect(result).toBe("hello world\n\n— @user1 via copy-over");
  });

  test("handles multiline comment bodies", () => {
    const body = "First line\n\nSecond paragraph\n- bullet point";
    const result = formatCommentForAdo(body, "devuser");
    expect(result).toBe(
      "First line\n\nSecond paragraph\n- bullet point\n\n— @devuser via copy-over"
    );
  });

  test("handles empty comment body", () => {
    const result = formatCommentForAdo("", "ghost");
    expect(result).toBe("\n\n— @ghost via copy-over");
  });
});

describe("buildCommentMarker", () => {
  test("builds a marker with the comment ID", () => {
    const marker = buildCommentMarker(123456);
    expect(marker).toBe("<!-- gh-comment-id:123456 -->");
  });

  test("handles large comment IDs", () => {
    const marker = buildCommentMarker(9999999999);
    expect(marker).toBe("<!-- gh-comment-id:9999999999 -->");
  });
});

describe("extractCommentMarker", () => {
  test("extracts comment ID from ADO comment text", () => {
    const text =
      "Some comment\n\n— @user via copy-over\n\n<!-- gh-comment-id:123456 -->";
    const id = extractCommentMarker(text);
    expect(id).toBe(123456);
  });

  test("returns undefined when no marker is present", () => {
    const text = "A regular comment with no marker";
    const id = extractCommentMarker(text);
    expect(id).toBeUndefined();
  });

  test("returns undefined for malformed markers", () => {
    const text = "<!-- gh-comment-id:abc -->";
    const id = extractCommentMarker(text);
    expect(id).toBeUndefined();
  });

  test("extracts from marker embedded in larger text", () => {
    const text =
      "Hello world\nMore text\n<!-- gh-comment-id:42 -->\nTrailing text";
    const id = extractCommentMarker(text);
    expect(id).toBe(42);
  });
});
