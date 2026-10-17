import { describe, expect, it } from "vitest";
import { builderCommandType, consumeBuilderCommand } from "./builder-command";

// Which builder chat messages ask for an agent: the composer switches Create
// agent on for them, and the builder's turn gets the build tools.
describe("builderCommandType", () => {
  it("reads a request for an agent, in words or as the command, and leaves questions and refusals alone", () => {
    const requests = [
      "/Create agent Flag deals with no activity for 14 days",
      "/create-agent brief every deal owner",
      "Set up an agent that flags stale deals",
      "Can you build me an agent that posts new deals to Slack?",
      "Please create a new agent for renewals",
    ];
    const questions = [
      "How do I create an agent?",
      "Should I build an agent for this?",
      "Don't create an agent, just list the stale deals",
      "Which deals have gone quiet?",
    ];
    expect(requests.map(builderCommandType)).toEqual(
      requests.map(() => "CREATE_AGENT"),
    );
    expect(questions.map(builderCommandType)).toEqual(
      questions.map(() => "CHAT"),
    );
  });
});

describe("consumeBuilderCommand", () => {
  it("returns what follows the command, and nothing for a plain message", () => {
    expect(consumeBuilderCommand("/Create agent Flag stale deals")).toBe(
      "Flag stale deals",
    );
    expect(consumeBuilderCommand("Set up an agent")).toBeNull();
  });
});
