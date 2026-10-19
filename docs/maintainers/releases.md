# Releases

A release is a version in `package.json`, its entry in [release-notes.md](../release-notes.md), and a tag `v<version>` on the commit that has both. Self-hosters upgrade from tag to tag ([self-hosting.md](../self-hosting.md#upgrading)).

## Cutting one

1. Start from `main` with `pnpm ci:check` passing.
2. Add the release's entry at the top of `docs/release-notes.md`:
   - **Needs:** the oldest Every App commit the release works with. While the SDK and CLI are linked from a checkout, that's the newest Every App change the CRM relies on: an SDK export, a CLI command or flag, or a gateway capability, scope or redirect path.
   - **Breaking changes:** what a self-hoster must do, or loses: a removed feature or route, a renamed setting, a migration that drops or rewrites data.
   - **Settings:** new gateway keys, CRM secrets (`CRM_SECRETS` in `cloudflare.config.ts`) and workspace settings.
   - **Migrations:** each file added to `drizzle/sqlite` and `drizzle/pg` since the last tag (`git diff --name-only v0.1.0..HEAD -- drizzle`), and what it changes.
3. Set `version` in `package.json`. While it's 0.x, a breaking change takes a minor version and anything else a patch.
4. Commit both, then tag that commit and push the tag:

   ```bash
   git tag -a v0.1.0 -m v0.1.0
   git push origin v0.1.0
   ```

5. Publish the entry as the tag's GitHub release: `gh release create v0.1.0 --title v0.1.0 --notes-file <the entry, saved to a file>`.
