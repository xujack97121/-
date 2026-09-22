const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");

// Opt-in Windows test: only a unique test registry key is created, never app keys.
const compiler = process.env.NSIS_MAKENSIS;
assert.equal(process.platform, "win32", "this integration test requires Windows");
assert.ok(compiler, "set NSIS_MAKENSIS to the installed makensis.exe path");
const root = path.resolve(__dirname, "../..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-installer-test-"));
const registryKey = `Software\\XhsInstallerTests\\${randomUUID()}`;
const executable = path.join(temporary, "installer-hooks.exe");
const source = path.join(temporary, "installer-hooks.nsi");
const scenarios = [
  ["fresh", 0, 'ClearErrors\nStrCpy $R0 0\n!insertmacro XhsCheckPreviousUninstall HKCU'],
  ["launch-error", 2, 'StrCpy $R0 0\nSetErrors\n!insertmacro XhsCheckPreviousUninstall HKCU'],
  ["exit-error", 2, 'ClearErrors\nStrCpy $R0 7\n!insertmacro XhsCheckPreviousUninstall HKCU'],
  ["stale-uninstall", 2, 'WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString "old.exe"\nClearErrors\nStrCpy $R0 0\n!insertmacro XhsCheckPreviousUninstall HKCU'],
  ["stale-location", 2, 'WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\\old-app"\nClearErrors\nStrCpy $R0 0\n!insertmacro XhsCheckPreviousUninstall HKCU'],
  ["shell-context", 0, 'SetShellVarContext current\nClearErrors\nStrCpy $R0 0\n!insertmacro customUnInstallCheck'],
  ["current-user", 0, 'ClearErrors\nStrCpy $R0 0\n!insertmacro customUnInstallCheckCurrentUser'],
  ["detect-none", 0, '!insertmacro XhsDetectInstallation HKCU $XhsHasUserInstall\n${If} $XhsHasUserInstall != "0"\nSetErrorLevel 90\nQuit\n${EndIf}'],
  ["detect-uninstall", 0, 'WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString "old.exe"\n!insertmacro XhsDetectInstallation HKCU $XhsHasUserInstall\n${If} $XhsHasUserInstall != "1"\nSetErrorLevel 90\nQuit\n${EndIf}'],
  ["detect-location", 0, 'WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\\old-app"\n!insertmacro XhsDetectInstallation HKCU $XhsHasUserInstall\n${If} $XhsHasUserInstall != "1"\nSetErrorLevel 90\nQuit\n${EndIf}'],
];
for (const [name, machine, user, forceMachine, forceUser] of [
  ["mode-fresh", "0", "0", "0", "0"],
  ["mode-user", "0", "1", "0", "1"],
  ["mode-machine", "1", "0", "1", "0"],
  ["mode-both", "1", "1", "1", "0"],
]) {
  scenarios.push([name, 0, `
StrCpy $XhsHasMachineInstall "${machine}"
StrCpy $XhsHasUserInstall "${user}"
StrCpy $isForceMachineInstall "0"
StrCpy $isForceCurrentInstall "0"
!insertmacro customInstallMode
\$\{If\} $isForceMachineInstall != "${forceMachine}"
\$\{OrIf\} $isForceCurrentInstall != "${forceUser}"
  SetErrorLevel 90
  Quit
\$\{EndIf\}
`]);
}

const script = `
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${executable}"
!include "FileFunc.nsh"
!define INSTALL_REGISTRY_KEY "${registryKey}\\Install"
!define UNINSTALL_REGISTRY_KEY "${registryKey}\\Uninstall"
!include "${path.join(root, "build", "installer.nsh")}"
Var isForceMachineInstall
Var isForceCurrentInstall
Section
  SetRegView 64
  DeleteRegKey HKCU "${registryKey}"
  \$\{GetParameters\} $2
  \$\{If\} $2 == "cleanup"
    SetErrorLevel 0
    Quit
  \$\{EndIf\}
${scenarios.map(([name, , body]) => `
  \$\{If\} $2 == "${name}"
    ${body}
    DeleteRegKey HKCU "${registryKey}"
    SetErrorLevel 0
    Quit
  \$\{EndIf\}
`).join("\n")}
  SetErrorLevel 99
SectionEnd
`;

try {
  fs.writeFileSync(source, script, "utf8");
  const compilation = spawnSync(compiler, ["/V2", "/INPUTCHARSET", "UTF8", source], { encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
  for (const [name, expected] of scenarios) {
    const result = spawnSync(executable, [name], { timeout: 10000, windowsHide: true });
    assert.equal(result.status, expected, `${name}: ${result.error || result.stderr}`);
    console.log(`Installer runtime: ${name} passed`);
  }
} finally {
  if (fs.existsSync(executable)) {
    const cleanup = spawnSync(executable, ["cleanup"], { timeout: 10000, windowsHide: true });
    assert.equal(cleanup.status, 0, "test registry cleanup failed");
  }
  // mkdtemp creates this exact directory exclusively for this test run.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith("xhs-installer-test-"));
  fs.rmSync(temporary, { recursive: true, force: true });
}
