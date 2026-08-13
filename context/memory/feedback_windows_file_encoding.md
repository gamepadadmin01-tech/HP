---
name: feedback-windows-file-encoding
description: "PowerShell 5.1 Set-Content adds a BOM and can flip CRLF to LF — this silently breaks .bat, YAML frontmatter and JSON"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:56:39.512Z
---

Editing Windows files with PowerShell 5.1 corrupted several files on 2026-08-14. Both failure
modes are silent — the file *looks* right in every text view.

## The two traps

1. **`Set-Content -Encoding UTF8` writes a BOM.** A BOM in front of a YAML `---` breaks frontmatter
   parsing. In `.json` it breaks strict parsers. It put a BOM into 11 memory files,
   `launch.json`, `local.properties` and two `.py` scripts.
2. **Round-tripping through `Get-Content -Raw` / `Set-Content` flips CRLF to LF.** This is the one
   that actually broke a build: **`cmd.exe` misparses `.bat` files with LF-only line endings.**
   The symptom is bizarre and misleading — partial tokens like `'M' is not recognized` (from
   `REM`), and `JAVA_HOME is set to an invalid directory: "= 1>&2`. It looks like a corrupted path
   or an encoding problem with the em-dashes in the comments. It is neither. It is the line
   endings.

## How to apply

- **`.bat` / `.cmd` must be CRLF.** The original `build_apk.bat` was UTF-8-with-BOM + CRLF and
  worked fine — match that, don't "clean it up".
- **`.sh` must stay LF.** Do not CRLF a shell script.
- To write a file with explicit control, use .NET rather than the cmdlets:
  ```powershell
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)   # $true for BOM
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
  ```
- Prefer the **Edit tool** over PowerShell text surgery. It preserves encoding and line endings,
  and it can't match a non-unique anchor — which is the other way files have been destroyed here
  (see [[feedback_no_worktrees]] and `context/recovery/README.md`).
- After editing any build file, **actually run it.** Both of these bugs pass every static check
  and only surface at execution.

Detecting them:
```bash
grep -q $'\r' file.bat && echo CRLF || echo "LF ONLY - will break cmd"
head -c 3 file.md | od -An -tx1        # efbbbf = BOM
```
