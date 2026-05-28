Set WshShell = CreateObject("WScript.Shell")
' Ejecuta el .bat de forma completamente oculta (el parámetro 0 hace la magia)
WshShell.Run chr(34) & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\iniciar-bodega.bat" & Chr(34), 0
Set WshShell = Nothing