# Release Delivery

Every completed application change is published to GitHub unless the user
explicitly requests local-only work.

1. Preserve existing work and review all changes intended for the release.
2. Increment the patch version (or the appropriate larger version) in
   `package.json` and `package-lock.json`. Never reuse a published version.
3. Update `RELEASE_NOTES.md`, run `npm run check`, relevant UI tests, and
   `node scripts/verify-release.cjs`.
4. Commit the reviewed source and push it to `origin/main`. Do not force-push.
5. The release workflow builds Windows and macOS, verifies the Windows
   installer against `latest.yml`, uploads all assets to a draft release,
   then publishes it as latest. Wait for this workflow to finish.
6. Verify the release tag, source commit, Windows EXE, macOS DMG,
   `latest.yml`, and EXE blockmap. Report the published release URL.

Never replace an EXE without regenerating and rechecking its matching
`latest.yml` and blockmap. Never overwrite an already published release.
Never commit account sessions, collection data, API keys, build caches, or
GitHub credentials.

Windows online updates use `electron-updater` with SHA-512 verification.
The app checks automatically but downloads and installs only on user request.
Installation is blocked during capture, automation, or AI analysis.
macOS currently links to the official release installer because the project
does not yet have an Apple distribution signing identity.

Versions before v2.0.6 require one manual upgrade to enable in-app updates.
