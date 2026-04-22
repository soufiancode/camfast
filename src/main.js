const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, Tray, Menu, nativeImage, globalShortcut, clipboard, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

// Fix FFMPEG path when packaged inside app.asar
const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

let mainWindow;
let overlayWindow;
let tray;
let borderWindow = null;
let webcamWindow = null;

// ── IPC: Webcam Window ────────────────────────────────────────────
ipcMain.on('toggle-webcam', (event, show, deviceId) => {
  if (show) {
    if (!webcamWindow || webcamWindow.isDestroyed()) {
      webcamWindow = new BrowserWindow({
        width: 320,
        height: 180,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });
      webcamWindow.setAspectRatio(16/9);
      webcamWindow.loadFile(path.join(__dirname, 'webcam.html'));
      
      webcamWindow.webContents.on('did-finish-load', () => {
        webcamWindow.webContents.send('set-webcam-device', deviceId);
      });
    } else {
      webcamWindow.webContents.send('set-webcam-device', deviceId);
      webcamWindow.show();
    }
  } else {
    if (webcamWindow && !webcamWindow.isDestroyed()) {
      webcamWindow.close();
      webcamWindow = null;
    }
  }
});

// ── Helper: Analyze silence segments using ffmpeg silencedetect ───────────
function analyzeSilence(inputFile, threshold = '-35', duration = '0.5', trimStart, trimEnd) {
  return new Promise((resolve) => {
    let args = ['-y'];
    if (trimStart !== undefined && trimStart !== null) args.push('-ss', trimStart.toString());
    if (trimEnd !== undefined && trimEnd !== null) args.push('-to', trimEnd.toString());
    args.push('-i', inputFile, '-af', `silencedetect=noise=${threshold}dB:d=${duration}`, '-f', 'null', '-');

    let stderr = '';
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', () => {
      const silences = [];
      const startMatches = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)];
      const endMatches = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)];
      for (let i = 0; i < startMatches.length; i++) {
        const start = parseFloat(startMatches[i][1]);
        const end = endMatches[i] ? parseFloat(endMatches[i][1]) : null;
        if (end !== null) silences.push({ start, end });
      }
      resolve(silences);
    });
    proc.on('error', () => resolve([]));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 380,
    resizable: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlay(bounds) {
  overlayWindow = new BrowserWindow({
    x: bounds.x || 0,
    y: bounds.y || 0,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(false);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  // Also necessary — without it the camera won't work even if we accept the request above
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  // Handle getDisplayMedia to allow screen recording with ability to hide mouse and record audio
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const streamConfig = { video: sources[0] };
      if (request.audioRequested) {
        streamConfig.audio = 'loopback'; // Loopback to capture system audio
      }
      callback(streamConfig);
    }).catch(err => {
      console.error('Error getting sources:', err);
      callback(null);
    });
  });

  createWindow();

  // Create tray
  try {
    const trayIconPath = path.join(__dirname, 'icon.ico');
    if (fs.existsSync(trayIconPath)) {
      tray = new Tray(trayIconPath);
    } else {
      const img = nativeImage.createEmpty();
      tray = new Tray(img);
    }
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show CAMFAST', click: () => mainWindow && mainWindow.show() },
      { type: 'separator' },
      { label: 'Start Recording', click: () => mainWindow && mainWindow.webContents.send('shortcut-action', 'start') },
      { label: 'Stop Recording', click: () => mainWindow && mainWindow.webContents.send('shortcut-action', 'stop') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setToolTip('CAMFAST');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (e) {
    // tray icon optional
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  
  // Cleanup temp recording files
  try {
    const tmpdir = os.tmpdir();
    const files = fs.readdirSync(tmpdir);
    files.forEach(f => {
      if (f.startsWith('temp-rec-') && f.endsWith('.webm')) {
        fs.unlinkSync(path.join(tmpdir, f));
      }
    });
  } catch (err) { console.error('Cleanup error:', err); }
});

app.on('window-all-closed', () => {
  app.quit();
});

// ── IPC: Get sources ──────────────────────────────────────────────
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 }
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

// Helper function: Formats current date/time as M-D-YYYY_HH-mm_ss
function getFormattedTimestamp() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const YYYY = now.getFullYear();
  const M = now.getMonth() + 1;
  const D = now.getDate();
  const HH = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${M}-${D}-${YYYY}_${HH}-${mm}_${ss}`;
}

// ── IPC: Save screenshot ──────────────────────────────────────────
ipcMain.handle('save-screenshot', async (event, payload) => {
  const { dataUrl, autoSave, savePath } = payload;
  const isJpg = dataUrl.startsWith('data:image/jpeg');
  const ext = isJpg ? 'jpg' : 'png';
  const extName = isJpg ? 'JPEG Image' : 'PNG Image';
  const fileName = `screenshot ${getFormattedTimestamp()}.${ext}`;

  let finalPath;

  if (autoSave && savePath && fs.existsSync(savePath)) {
    finalPath = path.join(savePath, fileName);
  } else {
    const defaultLocation = (savePath && fs.existsSync(savePath)) ? path.join(savePath, fileName) : fileName;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Screenshot',
      defaultPath: defaultLocation,
      filters: [{ name: extName, extensions: [ext] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false };
    }
    finalPath = result.filePath;
  }

  const base64 = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, '');
  fs.writeFileSync(finalPath, Buffer.from(base64, 'base64'));
  return { success: true, path: finalPath };
});

// ── IPC: Copy to Clipboard ────────────────────────────────────────
ipcMain.on('copy-to-clipboard', (event, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
  } catch (err) { console.error('Clipboard copy error:', err); }
});

// ── IPC: Save recording ───────────────────────────────────────────
ipcMain.handle('save-recording', async (event, data) => {
  const ext = data.format || 'mp4';
  const fileName = `video ${getFormattedTimestamp()}.${ext}`;
  const filters = ext === 'mp4' ? [{ name: 'MP4 Video', extensions: ['mp4'] }]
                : ext === 'avi' ? [{ name: 'AVI Video', extensions: ['avi'] }]
                : ext === 'gif' ? [{ name: 'GIF Animation', extensions: ['gif'] }]
                : [{ name: 'WebM Video', extensions: ['webm'] }];

  if (ext !== 'mp4') filters.push({ name: 'MP4 Video', extensions: ['mp4'] });
  if (ext !== 'avi') filters.push({ name: 'AVI Video', extensions: ['avi'] });
  if (ext !== 'gif') filters.push({ name: 'GIF Animation', extensions: ['gif'] });
  if (ext !== 'webm') filters.push({ name: 'WebM Video', extensions: ['webm'] });

  let finalPath;

  if (data.autoSave && data.savePath && fs.existsSync(data.savePath)) {
    finalPath = path.join(data.savePath, fileName);
  } else {
    const defaultLocation = (data.savePath && fs.existsSync(data.savePath)) ? path.join(data.savePath, fileName) : fileName;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Recording',
      defaultPath: defaultLocation,
      filters: filters
    });
    if (result.canceled || !result.filePath) {
      // Avoid deleting the original imported video by mistake and return canceled state
      if (!data.isImported && data.tempFiles) {
        data.tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
      }
      return { success: false, canceled: true };
    }
    finalPath = result.filePath;
  }

  const speed = parseFloat(data.speed || '1');
  const pitchVal = parseFloat(data.pitch || '50');
  const hasAudio = data.hasAudio;
  // Support both formats: tempFiles (array) or tempFilePath (old string)
  const tempFiles = data.tempFiles || (data.tempFilePath ? [data.tempFilePath] : []);
  const isImported = data.isImported || false;
  let trimStart = data.trimStart;
  let trimEnd = data.trimEnd;
  
  if (tempFiles.length === 0) return { success: false, error: 'No temp files recorded.' };

  const skipSilence = data.skipSilence;
  const silenceThreshold = data.silenceThreshold || '-35';
  const silenceDuration = data.silenceDuration || '0.5';
  let isTrimmed = false;
  let segments = [];
  let listPath = null;
  let processingFile = tempFiles[0];
  let intermediateFiles = [];

  if (skipSilence && hasAudio && tempFiles.length > 0) {
    event.sender.send('conversion-started', 'Stabilizing Video...');
    const tempCfrPath = path.join(os.tmpdir(), `cfr-${Date.now()}.mp4`);
    intermediateFiles.push(tempCfrPath);
    
    try {
       await new Promise((res, rej) => {
         let cfrArgs = ['-y', '-i', tempFiles[0]];
         if (trimStart !== undefined && trimStart !== null) cfrArgs.push('-ss', trimStart.toString());
         if (trimEnd !== undefined && trimEnd !== null) cfrArgs.push('-to', trimEnd.toString());
         cfrArgs.push('-r', (data.fps || 30).toString(), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', tempCfrPath);
         const cfrProc = spawn(ffmpegPath, cfrArgs, { windowsHide: true });
         cfrProc.on('close', (code) => { if (code === 0) res(); else rej(); });
         cfrProc.on('error', rej);
       });

       // Reset trims since they were applied during CFR encoding
       trimStart = null;
       trimEnd = null;
       processingFile = tempCfrPath;
       
       event.sender.send('conversion-started', 'Analyzing Silence...');
       const silences = await analyzeSilence(processingFile, silenceThreshold, silenceDuration, null, null);
       
       let currentStart = 0;

       if (silences.length > 0) {
         silences.forEach(s => {
           if (s.start > currentStart) {
             segments.push({ start: currentStart, end: s.start });
           }
           currentStart = Math.max(currentStart, s.end);
         });
         segments.push({ start: currentStart, end: 999999 });
         if (segments.length > 1) isTrimmed = true;
       }
    } catch (e) {
      console.error("Silence processing failed:", e);
      processingFile = tempFiles[0];
      trimStart = data.trimStart;
      trimEnd = data.trimEnd;
    }
  }

  // If native WebM, no speed change, and no pitch change, just save it directly
  if (!isImported && tempFiles.length === 1 && finalPath.endsWith('.webm') && speed === 1 && pitchVal === 50 && !isTrimmed && (trimStart == null) && (trimEnd == null)) {
    event.sender.send('conversion-started', 'Saving file...');
    if (fs.existsSync(tempFiles[0])) {
      try {
        await fs.promises.copyFile(tempFiles[0], finalPath);
        await fs.promises.unlink(tempFiles[0]);
      } catch (err) { console.error('Copy error:', err); }
    }
    return { success: true, path: finalPath };
  }

  event.sender.send('conversion-started', 'Converting video...');
  return new Promise((resolve) => {
    const outFps = data.fps || 30;
    const inputFile = tempFiles[0];
    let args = ['-y'];
    
    if (isTrimmed) {
      listPath = path.join(os.tmpdir(), `list-${Date.now()}.txt`);
      let listContent = '';
      segments.forEach(seg => {
        listContent += `file '${inputFile.replace(/'/g, "'\\''").replace(/\\/g, '/')}'\n`;
        listContent += `inpoint ${seg.start}\n`;
        if (seg.end !== 999999) {
          listContent += `outpoint ${seg.end}\n`;
        }
      });
      fs.writeFileSync(listPath, listContent);
      args.push('-f', 'concat', '-safe', '0', '-i', listPath);
    } else {
      if (trimStart !== undefined && trimStart !== null) args.push('-ss', trimStart.toString());
      if (trimEnd !== undefined && trimEnd !== null) args.push('-to', trimEnd.toString());
      args.push('-i', inputFile);
    }
    
    let vf = [];
    let af = [];
    
    let pitchFactor = 1.0;
    if (pitchVal < 50) {
      pitchFactor = 0.5 + (pitchVal / 50) * 0.5; // Map 0-50 to 0.5x-1.0x
    } else if (pitchVal > 50) {
      pitchFactor = 1.0 + ((pitchVal - 50) / 50) * 1.0; // Map 50-100 to 1.0x-2.0x
    }
    
    if (speed !== 1) {
      vf.push(`setpts=${1/speed}*PTS`);
    }
      
    if (hasAudio) {
      if (pitchFactor !== 1.0) af.push(`asetrate=${48000 * pitchFactor}`);
      
      let totalAtempo = (1 / pitchFactor) * speed;
      while (totalAtempo < 0.5) { af.push('atempo=0.5'); totalAtempo /= 0.5; }
      while (totalAtempo > 100.0) { af.push('atempo=100.0'); totalAtempo /= 100.0; }
      
      if (Math.abs(totalAtempo - 1.0) > 0.001) {
        af.push(`atempo=${totalAtempo}`);
      }
      
      if (pitchFactor !== 1.0) af.push('aresample=48000'); // Normalize back to standard sample rate
    }

    if (ext === 'gif') {
      let gifVf = vf.join(',');
      if (gifVf) gifVf += ',';
      gifVf += 'fps=15,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
      args.push('-filter_complex', gifVf);
    } else {
      if (vf.length > 0) args.push('-filter:v', vf.join(','));
      if (af.length > 0 && hasAudio) args.push('-filter:a', af.join(','));
    }

    if (ext === 'mp4' || ext === 'avi') {
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18');
      if (hasAudio && ext === 'mp4') {
        args.push('-c:a', 'aac');
      }
    }
    
    args.push('-r', outFps.toString());
    args.push(finalPath);
    
    const ffmpegProcess = spawn(ffmpegPath, args, { windowsHide: true });
    ffmpegProcess.on('close', (code) => {
      // Delete temporary files
      tempFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
      intermediateFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
      if (listPath && fs.existsSync(listPath)) { try { fs.unlinkSync(listPath); } catch(e){} }
      if (code === 0) {
        resolve({ success: true, path: finalPath });
      } else {
        resolve({ success: false, error: 'FFMPEG exited with code ' + code });
      }
    });
    ffmpegProcess.on('error', (err) => {
      // Delete temporary files
      tempFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
      intermediateFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
      if (listPath && fs.existsSync(listPath)) { try { fs.unlinkSync(listPath); } catch(e){} }
      resolve({ success: false, error: err.message });
    });
  });
});

// ── IPC: Open crop overlay ────────────────────────────────────────
ipcMain.handle('open-crop-overlay', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const bounds = primaryDisplay.bounds;

  if (mainWindow) mainWindow.hide();

  createOverlay(bounds);

  return new Promise((resolve) => {
    ipcMain.once('crop-selected', (event, rect) => {
      if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;
      }
      resolve(rect);
    });

    ipcMain.once('crop-cancelled', () => {
      if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;
      }
      if (mainWindow) mainWindow.show();
      resolve(null);
    });
  });
});

// ── IPC: Select Save Path ─────────────────────────────────────────
ipcMain.handle('select-save-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Default Save Folder',
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// ── IPC: Recording Streams ────────────────────────────────────────
let recStreamMain = null;
let recTempPathMain = null;

ipcMain.handle('rec-start', () => {
  recTempPathMain = path.join(os.tmpdir(), `temp-rec-${Date.now()}.webm`);
  recStreamMain = fs.createWriteStream(recTempPathMain);
  return recTempPathMain;
});

ipcMain.handle('rec-chunk', (event, buffer) => {
  return new Promise((resolve) => {
    if (recStreamMain && !recStreamMain.destroyed) {
      recStreamMain.write(Buffer.from(buffer), (err) => resolve(!err));
    } else {
      resolve(false);
    }
  });
});

ipcMain.handle('rec-stop', async () => {
  if (recStreamMain) {
    recStreamMain.end();
    await new Promise(r => recStreamMain.on('finish', r));
    recStreamMain = null;
  }
  return recTempPathMain;
});

// ── IPC: Open External URL ────────────────────────────────────────
ipcMain.on('open-external', (event, url) => {
  if (url) shell.openExternal(url);
});

// ── IPC: Window controls ──────────────────────────────────────────
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  app.quit();
});

ipcMain.on('hide-main-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('show-main-window', () => {
  if (mainWindow) mainWindow.show();
});

ipcMain.on('expand-window', () => {
  if (mainWindow) {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(800, 600);
    mainWindow.setSize(900, 600, true);
    mainWindow.center();
  }
});

ipcMain.on('shrink-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setResizable(false);
    mainWindow.setMinimumSize(380, 380);
  }
});

ipcMain.on('toggle-maximize', () => {
  if (mainWindow) {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  }
});

ipcMain.on('maximize-window', () => {
  if (mainWindow && !mainWindow.isMaximized()) {
    mainWindow.maximize();
  }
});

ipcMain.on('unmaximize-window', () => {
  if (mainWindow && mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }
});

// ── IPC: Auto Resize Window ───────────────────────────────────────
ipcMain.on('resize-window', (event, width, height) => {
  if (mainWindow && width > 0 && height > 0) {
    try {
      mainWindow.setSize(Math.round(width), Math.round(height), true);
    } catch (e) { console.error('Resize error:', e); }
  }
});

// ── IPC: Stealth Mode ─────────────────────────────────────────────
ipcMain.on('set-stealth-mode', (event, enable) => {
  if (mainWindow) mainWindow.setContentProtection(enable);
});

// ── IPC: Global Shortcuts ─────────────────────────────────────────
ipcMain.on('update-shortcuts', (event, shortcuts) => {
  globalShortcut.unregisterAll();
  if (!shortcuts) return;

  const actions = [
    { acc: shortcuts.full, action: 'full' },
    { acc: shortcuts.crop, action: 'crop' },
    { acc: shortcuts.start, action: 'start' },
    { acc: shortcuts.pause, action: 'pause' },
    { acc: shortcuts.stop, action: 'stop' }
  ];

  for (const { acc, action } of actions) {
    if (acc && typeof acc === 'string' && acc.trim() !== '' && acc !== 'None') {
      try {
        globalShortcut.register(acc, () => {
          if (mainWindow) mainWindow.webContents.send('shortcut-action', action);
        });
      } catch (err) { console.error('Failed to register shortcut:', acc); }
    }
  }
});

// ── IPC: Crop Border ──────────────────────────────────────────────
ipcMain.on('show-crop-border', (event, rect) => {
  if (borderWindow && !borderWindow.isDestroyed()) {
    borderWindow.close();
  }
  
  const borderSize = 1; // Thin border
  const handleSize = 26; // Handle size
  const gap = 6; // Safety gap so the frame doesn't appear in the video
  
  borderWindow = new BrowserWindow({
    x: Math.round(rect.x) - borderSize - gap,
    y: Math.round(rect.y) - borderSize - gap,
    width: Math.round(rect.w) + ((borderSize + gap) * 2) + handleSize,
    height: Math.round(rect.h) + ((borderSize + gap) * 2) + handleSize,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  borderWindow.setIgnoreMouseEvents(true, { forward: true });
  
  const borderHTML = `<!DOCTYPE html><html><head><style>
    body { margin: 0; padding: 0; overflow: hidden; background: rgba(0,0,0,0); user-select: none; }
    .marching-ants { position: absolute; top: 0; left: 0; width: calc(100% - ${handleSize}px); height: calc(100% - ${handleSize}px); border: ${borderSize}px dashed rgba(200, 200, 200, 0.5); box-sizing: border-box; pointer-events: none; }
    #move-handle { position: absolute; bottom: 0; right: 0; width: ${handleSize}px; height: ${handleSize}px; background: rgba(20, 20, 20, 0.85); color: #ccc; display: flex; align-items: center; justify-content: center; cursor: move; pointer-events: auto; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); transition: color 0.2s, background 0.2s; }
    #move-handle:hover { background: rgba(40, 40, 40, 0.95); color: #fff; }
    #move-handle svg { width: 14px; height: 14px; pointer-events: none; }
  </style></head><body>
    <div class="marching-ants"></div>
    <div id="move-handle" title="Move Crop Area">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="19 9 22 12 19 15"></polyline><polyline points="9 19 12 22 15 19"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
    </div>
    <script>
      const handle = document.getElementById('move-handle');
      handle.addEventListener('mouseenter', () => window.api.send('border-ignore-mouse', false));
      handle.addEventListener('mouseleave', () => { if (!isDragging) window.api.send('border-ignore-mouse', true); });
      let isDragging = false;
      let initialX = 0, initialY = 0;
      handle.addEventListener('pointerdown', (e) => {
        isDragging = true; initialX = e.screenX; initialY = e.screenY;
        handle.setPointerCapture(e.pointerId);
        window.api.send('border-drag-start');
      });
      handle.addEventListener('pointermove', (e) => {
        if (isDragging) window.api.send('border-drag-move', e.screenX - initialX, e.screenY - initialY);
      });
      handle.addEventListener('pointerup', (e) => {
        isDragging = false; handle.releasePointerCapture(e.pointerId);
        window.api.send('border-ignore-mouse', true);
      });
    </script>
  </body></html>`;
  borderWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(borderHTML));
});

ipcMain.on('hide-crop-border', () => {
  if (borderWindow && !borderWindow.isDestroyed()) {
    borderWindow.close();
  }
  borderWindow = null;
});

let borderOriginalBounds = null;

ipcMain.on('border-ignore-mouse', (event, ignore) => {
  if (borderWindow && !borderWindow.isDestroyed()) {
    if (ignore) {
      borderWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      borderWindow.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on('border-drag-start', () => {
  if (borderWindow && !borderWindow.isDestroyed()) {
    borderOriginalBounds = borderWindow.getBounds();
  }
});

ipcMain.on('border-drag-move', (event, dx, dy) => {
  if (borderWindow && !borderWindow.isDestroyed() && borderOriginalBounds) {
    const borderSize = 1;
    const handleSize = 26;
    const gap = 6;
    const newX = Math.round(borderOriginalBounds.x + dx);
    const newY = Math.round(borderOriginalBounds.y + dy);
    borderWindow.setBounds({ x: newX, y: newY, width: borderOriginalBounds.width, height: borderOriginalBounds.height });
    const newRect = { x: newX + borderSize + gap, y: newY + borderSize + gap, w: borderOriginalBounds.width - ((borderSize + gap) * 2) - handleSize, h: borderOriginalBounds.height - ((borderSize + gap) * 2) - handleSize };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('crop-bounds-updated', newRect);
    }
  }
});
