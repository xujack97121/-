# Windows Installer Upgrades

The installer replaces registered installations before extracting the new files.
Keep the historical app ID `com.xujack.xhscollector.multiaccount` unchanged and do
not introduce a new NSIS GUID.

## Behavior

- Fresh installations keep the existing wizard and shortcut options.
- Existing machine-wide installations select machine mode, even with `/S /currentuser`.
  The standard installer requests elevation as needed.
- Machine mode removes both the machine copy and the current user's copy, but does
  not enumerate installations belonging to other Windows users.
- Existing per-user installations keep that scope by default; `/allusers` can migrate them.
- The standard uninstaller runs synchronously before extraction, including same-version
  reinstalls, with data-preserving upgrade flags.
- Launch failures, nonzero exit codes, or remaining installation registration stop
  installation with exit code 2. Broken uninstallers require manual repair/removal.
- Account and collection data outside the installation directory are retained.
  Files manually saved inside the installation directory are not protected.
- Portable copies and products with different app IDs are not matched.

## Verification

Run `npm run test:packaging` and `npm run package:win` for configuration and compilation checks.
On Windows, set `NSIS_MAKENSIS` to the compiler path and run
`node tests/packaging/installer-runtime.test.cjs` to execute the actual custom hooks
with isolated registry fixtures. This does not replace full VM upgrade testing.
Before distribution, test these scenarios in a disposable Windows VM:

| Existing state | Expected result |
| --- | --- |
| No installation | Normal wizard and working shortcuts |
| Per-user older version | Old version removed before installing new version |
| Same version | Old version removed before reinstalling |
| Machine-wide version | Elevation and replacement |
| Both scopes | Both registrations removed; one machine installation remains |
| Machine install with `/S /currentuser` | Machine upgrade without a parallel user copy |
| Custom path with spaces | Old version removed and new target works |
| Running application | Standard close-app handling |
| Missing/failing uninstaller | Installation stops without extracting new files |
| Exit 0 but registration remains | Installation stops |
| Elevation refused | No replacement performed |
| Existing accounts and collections | Data remains available after upgrade |

Do not run destructive upgrade tests against a real user's installed copy.
