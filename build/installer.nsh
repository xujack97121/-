!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var XhsDesktopShortcutCheckbox
Var XhsCreateDesktopShortcut
Var XhsHasMachineInstall
Var XhsHasUserInstall

!macro XhsDetectInstallation ROOT RESULT
  StrCpy ${RESULT} "0"
  ReadRegStr $0 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $1 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $0 != ""
  ${OrIf} $1 != ""
    StrCpy ${RESULT} "1"
  ${EndIf}
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  StrCpy $XhsCreateDesktopShortcut ${BST_CHECKED}
  !insertmacro XhsDetectInstallation HKLM $XhsHasMachineInstall
  !insertmacro XhsDetectInstallation HKCU $XhsHasUserInstall

  ; Silent installs skip the mode page. Keep the machine upgrade/elevation path active.
  ${If} $XhsHasMachineInstall == "1"
    StrCpy $hasPerMachineInstallation "1"
    StrCpy $hasPerUserInstallation "0"
    !insertmacro setInstallModePerAllUsers
  ${EndIf}
  ClearErrors
!macroend

!macro customInstallMode
  ; Machine mode also removes the current user's copy through electron-builder.
  ${If} $XhsHasMachineInstall == "1"
    StrCpy $isForceMachineInstall "1"
  ${ElseIf} $XhsHasUserInstall == "1"
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

!macro XhsCheckPreviousUninstall ROOT
  ; Preserve the launch error before registry reads overwrite the NSIS error flag.
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "无法启动旧版本卸载程序，安装已停止。请先修复或卸载旧版本后重试。用户数据不会被主动清除。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "旧版本卸载未完成（错误码：$R0），安装已停止。请关闭旧版本后重试。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}

  ; A successful exit alone is insufficient if the old registration still exists.
  ReadRegStr $0 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $1 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
  ${OrIf} $1 != ""
    MessageBox MB_OK|MB_ICONSTOP "检测到旧版本尚未卸载完成，安装已停止。请在系统设置中卸载旧版本后重试。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ClearErrors
!macroend

!macro customUnInstallCheck
  !insertmacro XhsCheckPreviousUninstall SHELL_CONTEXT
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro XhsCheckPreviousUninstall HKEY_CURRENT_USER
!macroend

!macro customPageAfterChangeDir
  Function XhsShortcutPageCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "安装选项" "请选择需要创建的快捷方式"

    ${NSD_CreateLabel} 0 0 100% 28u "安装程序将把应用写入所选目录，并在开始菜单中创建入口。"
    Pop $0

    ${NSD_CreateCheckbox} 0 40u 100% 14u "创建桌面快捷方式"
    Pop $XhsDesktopShortcutCheckbox

    ${If} $XhsCreateDesktopShortcut == ${BST_CHECKED}
      ${NSD_Check} $XhsDesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function XhsShortcutPageLeave
    ${NSD_GetState} $XhsDesktopShortcutCheckbox $XhsCreateDesktopShortcut
  FunctionEnd

  Page custom XhsShortcutPageCreate XhsShortcutPageLeave
!macroend

!macro customInstall
  ${If} $XhsCreateDesktopShortcut != ${BST_CHECKED}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
!endif
