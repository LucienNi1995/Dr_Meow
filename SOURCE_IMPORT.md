# Release source import

Original project source imported from the manually uploaded release asset:
https://github.com/LucienNi1995/Dr_Meow/releases/download/v1.1.0/Dr-Meow-1.1.0-Source.zip

Verified SHA-256: `94d69e4a4d35f4e81025ac2280072568da77dd5829ec449904724ce1739b7325`.

The root README is the publisher's original usage and build documentation. The source now includes React/TypeScript, Electron, native Windows helper source, tests, pnpm lockfile, and electron-builder configuration. Earlier statements that original source was unavailable are superseded by this upload.

The `app/` folder is the earlier extracted packaged application, retained for reference. Develop and run commands from the repository root, not `app/`.

## Windows quick start

Prerequisites documented by the publisher: Windows 10/11 x64, Node.js 24, pnpm 11 (package.json specifies 11.25.0), and the Windows .NET Framework 4.x compiler.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Build and run locally:

```powershell
pnpm build
pnpm start
```

Generate the Windows installer:

```powershell
pnpm dist:win
```

Expected output: `release/Dr-Meow-Upgrade-1.1.0-x64.exe`. `pnpm pack:win` creates an unpacked application directory. The provided packaging configuration targets Windows; macOS packaging still needs implementation and validation.

The original source files were imported without executing project scripts. Dependency installation, compilation, and Windows runtime have not been verified on this Mac. Local `spec/` and `agent.md` remain ignored. No changes have been pushed.
