# Dr. Meow 1.1.0

Recovered release files on branch `release/v1.1.0`.

## Contents

- `app/dist/electron/`: packaged Electron main process and preload JavaScript.
- `app/dist/renderer/`: built renderer JavaScript, CSS, HTML, and pet assets.
- `app/package.json`: original packaged application metadata and dependencies.
- `app/node_modules/`: extracted dependencies available locally; excluded from Git.

These files were extracted without executing the Windows installer. This is a snapshot of the distributed application, not the original development project. Original React/TypeScript sources, source maps, build scripts, and lockfile were not present. No development or macOS build is configured, and runtime behavior has not been tested.

## Release provenance

Release: https://github.com/LucienNi1995/Dr_Meow/releases/tag/v1.1.0

The GitHub source archive contains only the original README. The Windows ZIP contains the upgrade installer. Its `resources/app.asar` contains the application files preserved under `app/`. Each extracted file was checked against the SHA-256 recorded in the ASAR header.

Downloads remain in `~/Downloads`:

| File | Verified SHA-256 |
| --- | --- |
| Dr-Meow-1.1.0-Windows-x64.zip | e952f1cd69d55b73fd910bbcdabd6c588c6e7fb32d6b031d01dc76b4e4ef7de6 |
| Dr-Meow-Upgrade-1.1.0-x64.exe | 42f9dad87dfefd198ce0c3698d4a425b9121069ad543cb0abf0ad49b08522d3a |

The original tag and main branch remain at the upstream initial commit. Windows binaries are kept outside Git. No files have been pushed to GitHub.
