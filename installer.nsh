!macro customUnInstall
  Var /GLOBAL drMeowRemoveLocalData
  StrCpy $drMeowRemoveLocalData "0"

  # The installer also runs this uninstaller to replace an old version.
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${If} ${Errors}
      ${If} $LANGUAGE == 2052
        StrCpy $R0 "是否删除当前 Windows 用户的 Dr. Meow 本地数据？$\r$\n$\r$\n包括保存的 ChatGPT 登录、聊天记录、桌宠状态和设置。选择「否」可保留这些数据供重新安装后使用。"
      ${Else}
        StrCpy $R0 "Remove Dr. Meow's local data for this Windows user?$\r$\n$\r$\nThis includes the saved ChatGPT sign-in, chat history, pet state, and settings. Choose No to keep them for a future installation."
      ${EndIf}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$R0" IDNO drMeowKeepLocalData
      StrCpy $drMeowRemoveLocalData "1"
      drMeowKeepLocalData:
    ${EndIf}
  ${EndIf}
  ClearErrors
!macroend

!macro removeDrMeowProfile FOLDER
  RMDir /r "$APPDATA\${FOLDER}"
  ${If} ${FileExists} "$APPDATA\${FOLDER}\*.*"
    StrCpy $R0 "1"
    DetailPrint "Could not remove $APPDATA\${FOLDER}"
  ${EndIf}
!macroend

!macro customUnInstallSection
  Section "un.-Dr. Meow local data"
    ${If} $drMeowRemoveLocalData == "1"
      SetShellVarContext current
      StrCpy $R0 "0"
      !insertmacro removeDrMeowProfile "${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        !insertmacro removeDrMeowProfile "${APP_PRODUCT_FILENAME}"
      !endif
      !insertmacro removeDrMeowProfile "${APP_PACKAGE_NAME}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
      ${If} $R0 == "1"
        ${If} $LANGUAGE == 2052
          StrCpy $R1 "部分 Dr. Meow 本地数据无法删除。请检查 $APPDATA 下剩余的 Dr. Meow 文件夹。"
        ${Else}
          StrCpy $R1 "Some Dr. Meow data could not be removed. Check the remaining Dr. Meow folders in $APPDATA."
        ${EndIf}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$R1"
      ${EndIf}
    ${EndIf}
  SectionEnd
!macroend

