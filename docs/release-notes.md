# Release notes

What each release changes for a self-hosted CRM. To upgrade, see [Upgrading](self-hosting.md#upgrading).

## 0.1.0

The first tagged release.

**Needs** an Every App checkout that includes commit `666013dd`, which gives the gateway the CRM's Google, Microsoft and Slack clients (`git merge-base --is-ancestor 666013dd HEAD` in that checkout says whether it does), Node.js 22.18 or newer, and pnpm 10.

**Breaking changes:** none.

**Settings:**

- On the gateway: `OPENROUTER_API_KEY`, `CONTEXT_API_KEY`, and the Google, Microsoft and Slack OAuth clients ([self-hosting.md](self-hosting.md#give-the-agent-its-keys)).
- On the CRM: `TOKEN_ENCRYPTION_KEY`, required before anyone connects mail, a calendar or Slack ([self-hosting.md](self-hosting.md#deploy-a-fork)); `GITHUB_TOKEN` and `OPENROUTER_MODEL`, both optional.
- The Slack app no longer needs `channels:history`, `groups:history`, `conversations.connect:write` or `links:write`.
- Settings → General → Research automatically, on by default.

**Migrations:** everything in `drizzle/sqlite`, which the deploy applies after taking a restore point.
