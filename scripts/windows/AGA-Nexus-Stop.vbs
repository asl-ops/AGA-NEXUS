Set shell = CreateObject("WScript.Shell")
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & "\stop-aga-nexus.ps1"""
shell.Run cmd, 0, False
