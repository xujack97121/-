const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const installerScript = fs.readFileSync(path.join(projectRoot, "build", "installer.nsh"), "utf8");
const nsis = packageJson.build?.nsis;
const customPageMacro = installerScript.match(/!macro customPageAfterChangeDir([\s\S]*?)!macroend/)?.[1] ?? "";

assert.equal(packageJson.main, "backend/main.cjs", "Electron must start from the backend boundary");
assert.deepEqual(packageJson.build?.files, ["dist/**/*", "backend/**/*", "package.json"]);
assert.equal(packageJson.build?.extraResources?.[0]?.from, "frontend/public/assets/ai-collector-icon.png");
assert.equal(packageJson.build?.win?.icon, "frontend/public/assets/ai-collector-icon.ico");
assert.equal(packageJson.build?.mac?.icon, "frontend/public/assets/ai-collector-icon.icns");
assert.equal(nsis?.oneClick, false, "Windows installer must use the assisted wizard");
assert.equal(nsis?.allowToChangeInstallationDirectory, true, "installer must expose the directory page");
assert.equal(nsis?.createDesktopShortcut, true, "desktop shortcut support must remain compiled in");
assert.equal(nsis?.createStartMenuShortcut, true, "start menu shortcut must remain enabled");
assert.equal(nsis?.include, "build/installer.nsh");
assert.equal(packageJson.build?.appId, "com.xujack.xhscollector.multiaccount", "keep the historical installation identity");
assert.equal(nsis?.guid, undefined, "continue deriving the historical uninstall key from appId");
assert.equal(nsis?.deleteAppDataOnUninstall, false, "uninstall must preserve account and collection data by default");

assert.match(installerScript, /MUI_PAGE_WELCOME/);
assert.match(installerScript, /!ifndef BUILD_UNINSTALLER/);
assert.match(installerScript, /skipPageIfUpdated/);
assert.match(installerScript, /NSD_CreateCheckbox[^\n]+创建桌面快捷方式/);
assert.match(customPageMacro, /Function XhsShortcutPageCreate/);
assert.match(customPageMacro, /\$\{isUpdated\}/);
assert.match(installerScript, /StrCpy \$XhsCreateDesktopShortcut \$\{BST_CHECKED\}/);
assert.match(installerScript, /WinShell::UninstShortcut "\$newDesktopLink"/);
assert.match(installerScript, /Delete "\$newDesktopLink"/);

const macro = (name) => {
  const body = installerScript.match(new RegExp(`!macro ${name}(?: [^\\r\\n]*)?\\r?\\n([\\s\\S]*?)!macroend`))?.[1];
  assert.ok(body, `missing installer macro: ${name}`);
  return body;
};
assert.match(macro("customInit"), /XhsDetectInstallation HKLM \$XhsHasMachineInstall/);
assert.match(macro("customInit"), /XhsDetectInstallation HKCU \$XhsHasUserInstall/);
assert.match(macro("customInit"), /StrCpy \$hasPerMachineInstallation "1"/);
assert.match(macro("customInit"), /!insertmacro setInstallModePerAllUsers/);
assert.match(macro("customInstallMode"), /\$XhsHasMachineInstall == "1"[\s\S]*StrCpy \$isForceMachineInstall "1"/);
assert.match(macro("customInstallMode"), /\$\{ElseIf\} \$XhsHasUserInstall == "1"[\s\S]*StrCpy \$isForceCurrentInstall "1"/);
assert.match(macro("customUnInstallCheck"), /XhsCheckPreviousUninstall SHELL_CONTEXT/);
assert.match(macro("customUnInstallCheckCurrentUser"), /XhsCheckPreviousUninstall HKEY_CURRENT_USER/);
const uninstallCheck = macro("XhsCheckPreviousUninstall");
assert.match(uninstallCheck, /\$\{If\} \$\{Errors\}[\s\S]*?SetErrorLevel 2\s+Quit/);
assert.match(uninstallCheck, /\$\{If\} \$R0 != 0[\s\S]*?SetErrorLevel 2\s+Quit/);
assert.match(uninstallCheck, /ReadRegStr \$0 \$\{ROOT\} "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString/);
assert.match(uninstallCheck, /ReadRegStr \$1 \$\{ROOT\} "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
assert.match(uninstallCheck, /\$\{If\} \$0 != ""\s+\$\{OrIf\} \$1 != ""[\s\S]*?SetErrorLevel 2\s+Quit/);
assert.equal((uninstallCheck.match(/\/SD IDOK/g) ?? []).length, 3, "silent upgrades must not wait for custom error dialogs");
assert.doesNotMatch(installerScript, /RMDir\s+\/r|--delete-app-data|ExecWait/i, "delegate removal and data preservation to the standard uninstaller");

console.log("Windows assisted installer configuration: passed");
