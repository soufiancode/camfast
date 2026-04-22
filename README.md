# CAMFAST 🎯
**Advanced & Lightweight Screenshot & Screen Recorder**
![Windows Support](https://img.shields.io/badge/Platform-Windows-blue?logo=windows)
![Arch](https://img.shields.io/badge/Architecture-x64-orange)

> [!IMPORTANT]
> **This application is only for Windows (64-bit).** It is not compatible with macOS or Linux.

---

### 📥 Direct Download
[Download CamFast.exe for Windows (64-bit) ]( https://github.com/soufiancode/camfast/releases/download/v1.0.0/CAMFAST.Setup.1.0.0.exe)

---

## 📁 Project Structure

```
CAMFAST/
├── src/
│   ├── main.js        ← Electron main process
│   ├── renderer.js    ← UI logic (screenshot + recording)
│   ├── index.html     ← Main window (300×200)
│   └── overlay.html   ← Crop selection overlay
├── package.json
└── README.md
```

---

## 🚀 Quick Start (Development)

### Step 1 — Open in VS Code
```
File → Open Folder → select the `CAMFAST` folder
```
Or via terminal:
```bash
code CAMFAST
```

### Step 2 — Install Dependencies
Open the VS Code terminal (`Ctrl + `` ` ``) and run:
```bash
npm install
```
This installs Electron (~40MB). Wait for it to finish.

### Step 3 — Run the App
```bash
npm start
```
The CAMFAST window (300×200) will appear.

---

## 📦 Build .exe for Windows

### Step 4 — Build
```bash
npm run build
```

Output will be in:
```
dist/
└── CAMFAST Setup 1.0.0.exe   ← installer
```

Double-click the `.exe` to install CAMFAST on any Windows machine.

---

## ✅ Features

| Feature | Details |
|---|---|
| Full screenshot | Captures entire screen → Save as PNG |
| Crop screenshot | Drag to select area → Save as PNG |
| Screen recording | Start / Pause / Resume / Stop |
| Save recording | Saves as `.webm` (plays on all browsers + VLC) |
| Quality settings | 720p / 1080p / 4K |
| FPS settings | 30 or 60 fps |
| System tray | Right-click tray icon to show/hide/quit |

---

## 📝 Notes

- Recording saves as **WebM** (VP9 codec) — plays in Chrome, Firefox, VLC, and most modern players.
- For MP4 output, you'd need `ffmpeg` bundled — not included to keep size minimal.
- Window is always-on-top so it stays accessible.
- Settings are saved locally via `localStorage`.

---

## ⚡ Requirements

- Node.js 18+ — [nodejs.org](https://nodejs.org)
- Windows 10/11 x64
- ~100MB free disk space (for node_modules during dev)
