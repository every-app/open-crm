import { describe, expect, it } from "vitest";
import { messageBody, stripHtml } from "./messageText";

// A message is a stranger's input: its text must read in linear time, or one
// crafted message stalls the cron for every organization.
describe("message text", () => {
  it("reads crafted markup and blank lines in linear time", () => {
    const started = performance.now();
    // Each of these took seconds with regexes that backtrack.
    stripHtml(`<p>Hi</p><style>${"a<style>".repeat(50_000)}`);
    stripHtml("<a".repeat(50_000));
    messageBody("\r\n".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("keeps an HTML body's text and its line breaks, without styles or scripts", () => {
    expect(
      stripHtml(
        `<style>p{color:red}</style><p>Hello&nbsp;there</p><div>a &lt;b&gt; &amp;lt;</div>one<br/>two<script>alert(1)</script>`,
      ),
    ).toBe("Hello there\na <b> &lt;\none\ntwo");
    // An unclosed style hides the rest, as it does in a mail client.
    expect(stripHtml("Kept<style>p{}</p>never shown")).toBe("Kept");
  });

  it("stores a body without its quoted history, cut at its limit", () => {
    expect(
      messageBody("Thanks!\r\n\r\nOn Mon, Jane <j@acme.com> wrote:\r\n> Hi"),
    ).toBe("Thanks!");
    const long = messageBody("x".repeat(60_000));
    expect(long).toHaveLength(50_000);
    expect(long.endsWith("…")).toBe(true);
  });
});
