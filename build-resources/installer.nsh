!macro customInstall
  CreateShortCut "$DESKTOP\Audio Subtitle.lnk" "$INSTDIR\Audio Subtitle.exe"
!macroend

!macro customUninstall
  Delete "$DESKTOP\Audio Subtitle.lnk"
  Delete "$SMPROGRAMS\Audio Subtitle\Audio Subtitle.lnk"
  RMDir "$SMPROGRAMS\Audio Subtitle"
  RMDir /r "$INSTDIR"
!macroend