import { describe, expect, it } from "vitest";
import { mailboxState, type Connection } from "./connectionCopy";

// The badge beside a provider. The sync skips a provider the gateway doesn't
// offer, so a mailbox connected before that is not "Connected".
describe("mailboxState", () => {
  const connection: Connection = {
    accountEmail: "maya@dailypour.example",
    needsReconnect: false,
    sources: [],
  };

  it("needs attention while the gateway doesn't offer the provider", () => {
    expect(mailboxState({ ready: true, connection })).toBe("connected");
    expect(mailboxState({ ready: false, connection })).toBe("attention");
  });
});
