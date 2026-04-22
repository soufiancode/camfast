// ── State ──────────────────────────────────────────────────────────────────
let settings = { 
  theme: 'system', language: 'en', quality: '1080', fps: '30', shotFormat: 'png', format: 'mp4', speed: '1', pitch: '50', micId: 'default', mic: true, webcamId: 'default', webcam: false, sys: true, delay: false, hide: false, stealth: false, autoSave: false, savePath: '', soundEffect: true,
  hkFull: 'Alt+F', hkCrop: 'Alt+C', hkStart: 'Alt+R', hkPause: 'Alt+P', hkStop: 'Alt+S'
};
let recordedChunks = [];
let timerInterval = null;
let timerSeconds = 0;
let isPaused = false;
let currentCropRect = null;
let recStream = null;
let recWritePromise = Promise.resolve();
let currentZoom = 1;
let baseCanvasWidth = 0;
let isWindowMaximized = false;
let autoMaximized = false;

// ── Global Shortcuts ───────────────────────────────────────────────────────
function sendShortcutsToMain() {
  const settingsPanel = document.getElementById('panel-settings');
  if (settingsPanel && settingsPanel.classList.contains('active')) {
    window.api.send('update-shortcuts', {});
  } else {
    window.api.send('update-shortcuts', {
      full: settings.hkFull,
      crop: settings.hkCrop,
      start: settings.hkStart,
      pause: settings.hkPause,
      stop: settings.hkStop
    });
  }
}

// ── Load settings from localStorage ──────────────────────────────────────
(function loadSettings() {
  try {
    const s = localStorage.getItem('camfast-settings');
    if (s) settings = { ...settings, ...JSON.parse(s) };
    
    if (document.getElementById('sel-theme')) document.getElementById('sel-theme').value = settings.theme || 'system';
    if (document.getElementById('sel-language')) document.getElementById('sel-language').value = settings.language || 'en';
    applyTheme(settings.theme || 'system');

    document.getElementById('sel-quality').value = settings.quality;
    document.getElementById('sel-fps').value = settings.fps;
    document.getElementById('sel-shot-format').value = settings.shotFormat || 'png';
    document.getElementById('sel-format').value = settings.format || 'mp4';
    document.getElementById('sel-speed').value = settings.speed || '1';
    document.getElementById('sel-pitch').value = settings.pitch || '50';
    document.getElementById('pitch-val').textContent = (settings.pitch || '50') + '%';
    document.getElementById('sel-mic').value = settings.micId || 'default';
    if (document.getElementById('sel-webcam')) document.getElementById('sel-webcam').value = settings.webcamId || 'default';
    
    // Fix corrupted shortcuts from old saves
    const fixHk = (val, def) => (!val || val === 'undefined' || val === 'null' || val === '') ? def : val;
    settings.hkFull = fixHk(settings.hkFull, 'Alt+F');
    settings.hkCrop = fixHk(settings.hkCrop, 'Alt+C');
    settings.hkStart = fixHk(settings.hkStart, 'Alt+R');
    settings.hkPause = fixHk(settings.hkPause, 'Alt+P');
    settings.hkStop = fixHk(settings.hkStop, 'Alt+S');

    document.getElementById('hk-full').value = settings.hkFull;
    document.getElementById('hk-crop').value = settings.hkCrop;
    document.getElementById('hk-start').value = settings.hkStart;
    document.getElementById('hk-pause').value = settings.hkPause;
    document.getElementById('hk-stop').value = settings.hkStop;
    
    localStorage.setItem('camfast-settings', JSON.stringify(settings));

    if (document.getElementById('auto-save-path')) document.getElementById('auto-save-path').value = settings.savePath || '';
    if (document.getElementById('chk-auto-save')) document.getElementById('chk-auto-save').checked = settings.autoSave || false;
    if (document.getElementById('chk-sound-effect')) document.getElementById('chk-sound-effect').checked = settings.soundEffect !== false;
  } catch (e) {}
  window.api.send('set-stealth-mode', settings.stealth);
  updateToggleUI();
  sendShortcutsToMain();
  
  if (settings.webcam) {
    window.api.send('toggle-webcam', true, settings.webcamId);
  }
})();

// ── Load Microphones & Webcams ────────────────────────────────────────────
async function populateDevices() {
  try {
    // Request microphone and camera permissions once so the browser can read device names clearly
    await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(e => {});
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const selMic = document.getElementById('sel-mic');
    selMic.innerHTML = '<option value="default">Default Microphone</option>';
    
    audioInputs.forEach(device => {
      if (device.deviceId === 'default' || device.deviceId === 'communications') return;
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.text = device.label || `Microphone ${selMic.options.length}`;
      selMic.appendChild(opt);
    });
    selMic.value = settings.micId || 'default';

    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    const selWebcam = document.getElementById('sel-webcam');
    if (selWebcam) {
      selWebcam.innerHTML = '<option value="default">Default Webcam</option>';
      videoInputs.forEach(device => {
        if (device.deviceId === 'default') return;
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        opt.text = device.label || `Webcam ${selWebcam.options.length}`;
        selWebcam.appendChild(opt);
      });
      selWebcam.value = settings.webcamId || 'default';
    }
  } catch (err) { console.error('Error fetching devices:', err); }
}
populateDevices();

function updateToggleUI() {
  const sysBtn = document.getElementById('tgl-sys');
  sysBtn.classList.toggle('active', settings.sys);
  sysBtn.innerHTML = settings.sys ? 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>` : 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

  const micBtn = document.getElementById('tgl-mic');
  micBtn.classList.toggle('active', settings.mic);
  micBtn.innerHTML = settings.mic ? 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>` : 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

  const webcamBtn = document.getElementById('tgl-webcam');
  if (webcamBtn) webcamBtn.classList.toggle('active', settings.webcam);

  const delayBtn = document.getElementById('tgl-delay');
  delayBtn.classList.toggle('active', settings.delay);
  
  const hideBtn = document.getElementById('tgl-hide');
  hideBtn.classList.toggle('active', settings.hide);
  hideBtn.innerHTML = settings.hide ? 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : 
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

  const stealthBtn = document.getElementById('tgl-stealth');
  stealthBtn.classList.toggle('active', settings.stealth);
  stealthBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01"></path><path d="M15 10h.01"></path><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"></path></svg>`;
 
}

// ── Quick Toggles Events ──────────────────────────────────────────────────
document.getElementById('tgl-sys').addEventListener('click', () => {
  settings.sys = !settings.sys;
  updateToggleUI();
  saveSettings();
});

document.getElementById('tgl-mic').addEventListener('click', () => {
  settings.mic = !settings.mic;
  updateToggleUI();
  saveSettings();
});

document.getElementById('tgl-webcam').addEventListener('click', () => {
  settings.webcam = !settings.webcam;
  updateToggleUI();
  saveSettings();
  window.api.send('toggle-webcam', settings.webcam, settings.webcamId);
});

document.getElementById('tgl-delay').addEventListener('click', () => {
  settings.delay = !settings.delay;
  updateToggleUI();
  saveSettings();
});

document.getElementById('tgl-hide').addEventListener('click', () => {
  settings.hide = !settings.hide;
  updateToggleUI();
  saveSettings();
});

document.getElementById('tgl-stealth').addEventListener('click', () => {
  settings.stealth = !settings.stealth;
  updateToggleUI();
  saveSettings();
  window.api.send('set-stealth-mode', settings.stealth);
});

window.api.on('shortcut-action', (action) => {
  const settingsPanel = document.getElementById('panel-settings');
  if (settingsPanel && settingsPanel.classList.contains('active')) return;

  if (action === 'full') document.getElementById('btn-capture-full').click();
  if (action === 'crop') document.getElementById('btn-capture-crop').click();
  if (action === 'start' && !document.getElementById('btn-start-rec').disabled) document.getElementById('btn-start-rec').click();
  if (action === 'pause' && !document.getElementById('btn-pause-rec').disabled) document.getElementById('btn-pause-rec').click();
  if (action === 'stop' && !document.getElementById('btn-stop-rec').disabled) document.getElementById('btn-stop-rec').click();
});

window.api.on('crop-bounds-updated', (newRect) => {
  currentCropRect = newRect;
});

window.api.on('conversion-started', (msg) => {
  const text = msg || 'Converting Video...';
  setRecStatus('Processing...');
  document.getElementById('rec-status').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:6px;color:var(--accent);"><svg class="spinner" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg><span style="letter-spacing: 2px;">${text}</span></div>`;
});

// ── Auto Resize Window ────────────────────────────────────────────────────
function adjustWindowSize() {
  setTimeout(() => {
    if (isWindowMaximized) return;
    let targetWidth = 380;
    const appWrapper = document.getElementById('app-wrapper');
    if (appWrapper) {
      window.api.send('resize-window', targetWidth, appWrapper.offsetHeight);
    }
  }, 30);
}

window.addEventListener('DOMContentLoaded', () => {
  new ResizeObserver(() => adjustWindowSize()).observe(document.getElementById('app-wrapper'));
});

// ── Tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    
    const tabName = tab.dataset.tab;
    let panel = document.getElementById('panel-' + tabName);
    if (!panel && tabName === 'rec') panel = document.getElementById('panel-recording') || document.getElementById('panel-record');
    if (!panel && tabName === 'set') panel = document.getElementById('panel-settings');
    
    if (panel) panel.classList.add('active');
    
    sendShortcutsToMain();
    adjustWindowSize();
  });
});

// ── Window controls ───────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click', () => {
  window.api.send('minimize-window');
});

document.getElementById('btn-close').addEventListener('click', () => {
  window.api.send('close-window');
});

const btnMax = document.getElementById('btn-max');
if (btnMax) {
  btnMax.addEventListener('click', () => window.api.send('toggle-maximize'));
}
window.api.on('window-maximized', (isMax) => {
  isWindowMaximized = isMax;
  if (btnMax) {
    btnMax.innerHTML = isMax ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 8H22V22H8z"/><path d="M8 8V2H2v14h6"/></svg>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
  }
  if (isMax) {
    document.body.classList.add('maximized');
  } else {
    document.body.classList.remove('maximized');
    adjustWindowSize();
  }
      setTimeout(() => {
        if (originalCanvas && document.getElementById('step-actions').style.display === 'flex') {
          fitImageToContainer();
        } else {
          resizeEditorCanvas();
        }
      }, 100);
});

// ── Status helper ─────────────────────────────────────────────────────────
function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
  if (type === 'ok') setTimeout(() => { el.textContent = 'Ready'; el.className = ''; }, 3000);
}

// ── Get screen source ─────────────────────────────────────────────────────
async function getScreenSource() {
  const sources = await window.api.invoke('get-sources');
  return sources[0]; // primary screen
}

// ── SCREENSHOT ────────────────────────────────────────────────────────────
let currentScreenshot = null;

function playSnapSound() {
  if (settings.soundEffect === false) return;
  try {
    const audio = new Audio('screenshot.mp3');
    audio.play().catch(e => console.error('Error playing sound:', e));
  } catch (e) {}
}

// ── SCREENSHOT EDITOR ─────────────────────────────────────────────────────
let originalCanvas = null;
let editHistory = [];
let redoHistory = [];
let currentTool = 'pen'; // 'move', 'pen', 'marker', 'eraser', 'blur', 'line', 'arrow', 'rect', 'circle', 'text'
let currentColor = '#ff0000';
let currentFont = 'Arial';
let currentTextBold = true;
let currentSize = 3;
let currentPoints = [];
let isDrawing = false;
let isSpaceDown = false;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;
let selectedShapeIndex = -1;
let lastMouseX = 0;
let lastMouseY = 0;
let drawStartX = 0;
let drawStartY = 0;
let editCanvasOverlay = null;
let baseImgHeight = 130;

const editorIcons = {
  pen: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`,
  marker: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"></path><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path></svg>`,
  move: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="19 9 22 12 19 15"></polyline><polyline points="9 19 12 22 15 19"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>`,
  eraser: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7l-4-4a2.828 2.828 0 0 1 0-4l10-10a2.828 2.828 0 0 1 4 0l4 4a2.828 2.828 0 0 1 0 4l-7 7"></path></svg>`,
  blur: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 4.2c1.44 1.06 2.34 2.76 2.34 4.54a8 8 0 1 1-16 0c0-1.78.9-3.48 2.34-4.54L12 2.69z"></path></svg>`,
  line: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="5" y1="19" x2="19" y2="5"></line></svg>`,
  arrow: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
  rect: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
  circle: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle></svg>`,
  text: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`,
  undo: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
  redo: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
  clear: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  zoomIn: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`,
  zoomOut: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`
};

function createEditorButton(iconHTML, onClick) {
  const btn = document.createElement('button');
  btn.innerHTML = iconHTML;
  btn.style.cursor = 'pointer';
  btn.style.padding = '6px';
  btn.style.background = 'var(--surface)';
  btn.style.color = 'var(--accent)';
  btn.style.border = '1px solid var(--border)';
  btn.style.borderRadius = '4px';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.onclick = onClick;
  return btn;
}

function injectEditorUI() {
  const toolsDiv = document.getElementById('editor-toolbar');
  const propsDiv = document.getElementById('editor-properties');
  
  if (toolsDiv) toolsDiv.style.display = 'flex';
  if (propsDiv) propsDiv.style.display = 'flex';

  if (toolsDiv && toolsDiv.children.length === 0) {
    const updatePropsVisibility = (tool) => {
      const usesColor = ['pen', 'marker', 'line', 'arrow', 'rect', 'circle', 'text'].includes(tool);
      const usesSize = ['pen', 'marker', 'eraser', 'blur', 'line', 'arrow', 'rect', 'circle', 'text'].includes(tool);
      
      const cp = document.getElementById('color-picker');
      if (cp) cp.style.display = usesColor ? 'block' : 'none';
      const sw = document.getElementById('size-wrapper');
      if (sw) sw.style.display = usesSize ? 'flex' : 'none';
      const fp = document.getElementById('font-picker');
      if (fp) fp.style.display = tool === 'text' ? 'block' : 'none';
      const bb = document.getElementById('btn-bold');
      if (bb) bb.style.display = tool === 'text' ? 'flex' : 'none';
      const sep = document.getElementById('props-sep');
      if (sep) sep.style.display = (usesColor || usesSize || tool === 'text') ? 'block' : 'none';
    };

    const tools = ['move', 'pen', 'marker', 'eraser', 'blur', 'line', 'arrow', 'rect', 'circle', 'text'];
    tools.forEach(t => {
      const btn = createEditorButton(editorIcons[t], () => {
        document.querySelectorAll('.editor-btn').forEach(b => b.style.opacity = '0.6');
        btn.style.opacity = '1';
        currentTool = t;
        
        updatePropsVisibility(t);
        
        const overlay = document.getElementById('edit-canvas-overlay');
        if (overlay) {
          overlay.style.cursor = t === 'move' ? 'move' : (t === 'text' ? 'text' : 'crosshair');
        }
      });
      btn.className = 'editor-btn';
      btn.dataset.tool = t;
      btn.title = t.charAt(0).toUpperCase() + t.slice(1);
      toolsDiv.appendChild(btn);
    });
    
    const colorPicker = document.createElement('input');
    colorPicker.id = 'color-picker';
    colorPicker.type = 'color';
    colorPicker.value = currentColor;
    colorPicker.title = 'Choose Color';
    colorPicker.style.cursor = 'pointer';
    colorPicker.style.border = '1px solid var(--border)';
    colorPicker.style.padding = '0';
    colorPicker.style.width = '30px';
    colorPicker.style.height = '30px';
    colorPicker.style.background = 'transparent';
    colorPicker.oninput = (e) => { 
      currentColor = e.target.value; 
      const txtInput = document.getElementById('text-tool-input');
      if (txtInput) {
        txtInput.style.color = currentColor;
        txtInput.style.border = '1px dashed ' + currentColor;
      }
    };
    propsDiv.appendChild(colorPicker);
    
    const sizeWrapper = document.createElement('div');
    sizeWrapper.id = 'size-wrapper';
    sizeWrapper.style.display = 'flex';
    sizeWrapper.style.alignItems = 'center';
    sizeWrapper.title = 'Adjust Size';
    
    const sizePicker = document.createElement('input');
    sizePicker.type = 'range';
    sizePicker.min = '1';
    sizePicker.max = '20';
    sizePicker.value = currentSize;
    sizePicker.style.cursor = 'pointer';
    sizePicker.style.width = '70px';
    sizePicker.oninput = (e) => { 
      currentSize = parseInt(e.target.value, 10); 
      const txtInput = document.getElementById('text-tool-input');
      if (txtInput) {
        txtInput.style.fontSize = (currentSize * 4 * currentZoom) + 'px';
        txtInput.style.width = ((txtInput.value.length + 2) * currentSize * 2.5 * currentZoom) + 'px';
      }
    };
    sizeWrapper.appendChild(sizePicker);
    propsDiv.appendChild(sizeWrapper);
    
    const fontPicker = document.createElement('select');
    fontPicker.id = 'font-picker';
    fontPicker.style.display = 'none';
    fontPicker.style.cursor = 'pointer';
    fontPicker.style.border = '1px solid var(--border)';
    fontPicker.style.borderRadius = '4px';
    fontPicker.style.background = 'var(--surface)';
    fontPicker.style.color = 'var(--accent)';
    fontPicker.style.padding = '2px';
    fontPicker.style.maxWidth = '80px';
    
    ['Arial', 'Courier New', 'Georgia', 'Impact', 'Tahoma', 'Times New Roman', 'Verdana'].forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      fontPicker.appendChild(opt);
    });
    fontPicker.onchange = (e) => { 
      currentFont = e.target.value; 
      const txtInput = document.getElementById('text-tool-input');
      if (txtInput) txtInput.style.fontFamily = currentFont;
    };
    propsDiv.appendChild(fontPicker);

    const btnBold = createEditorButton('B', () => {
      currentTextBold = !currentTextBold;
      btnBold.style.opacity = currentTextBold ? '1' : '0.5';
      const txtInput = document.getElementById('text-tool-input');
      if (txtInput) txtInput.style.fontWeight = currentTextBold ? 'bold' : 'normal';
    });
    btnBold.id = 'btn-bold';
    btnBold.style.display = 'none';
    btnBold.style.fontWeight = 'bold';
    btnBold.style.fontFamily = 'serif';
    btnBold.style.fontSize = '14px';
    btnBold.style.opacity = currentTextBold ? '1' : '0.5';
    btnBold.title = 'Toggle Bold';
    propsDiv.appendChild(btnBold);

    const sep = document.createElement('div');
    sep.id = 'props-sep';
    sep.style.width = '1px';
    sep.style.height = '20px';
    sep.style.background = 'var(--border, #444)';
    propsDiv.appendChild(sep);

    const btnUndo = createEditorButton(editorIcons.undo, undoEdit);
    btnUndo.title = 'Undo';
    propsDiv.appendChild(btnUndo);

    const btnRedo = createEditorButton(editorIcons.redo, redoEdit);
    btnRedo.title = 'Redo';
    propsDiv.appendChild(btnRedo);

    const btnClear = createEditorButton(editorIcons.clear, clearEdit);
    btnClear.title = 'Clear';
    propsDiv.appendChild(btnClear);

    const btnZoomOut = createEditorButton(editorIcons.zoomOut, () => {
      currentZoom = Math.max(0.5, currentZoom - 0.25);
      updateZoomUI();
    });
    btnZoomOut.title = 'Zoom Out (Ctrl -)';
    propsDiv.appendChild(btnZoomOut);

    const btnZoomIn = createEditorButton(editorIcons.zoomIn, () => {
      currentZoom = Math.min(5, currentZoom + 0.25);
      updateZoomUI();
    });
    btnZoomIn.title = 'Zoom In (Ctrl +)';
    propsDiv.appendChild(btnZoomIn);

    updatePropsVisibility(currentTool);

    const previewImg = document.getElementById('shot-preview');
    const previewContainer = previewImg.parentElement;
    previewContainer.style.position = 'relative';

    editCanvasOverlay = document.createElement('canvas');
    editCanvasOverlay.id = 'edit-canvas-overlay';
    editCanvasOverlay.style.position = 'absolute';
    editCanvasOverlay.style.top = '0';
    editCanvasOverlay.style.left = '0';
    editCanvasOverlay.style.cursor = 'crosshair';
    
    previewContainer.appendChild(editCanvasOverlay);

    editCanvasOverlay.addEventListener('mousedown', startDraw);
    editCanvasOverlay.addEventListener('mousemove', draw);
    editCanvasOverlay.addEventListener('mouseup', endDraw);
    editCanvasOverlay.addEventListener('mouseleave', endDraw);
  }

  // Reset tool selection state and properties visibility
  document.querySelectorAll('.editor-btn').forEach(b => {
    b.style.opacity = b.dataset.tool === currentTool ? '1' : '0.6';
  });
  
  if (propsDiv) {
    const usesColor = ['pen', 'marker', 'line', 'arrow', 'rect', 'circle', 'text'].includes(currentTool);
    const usesSize = ['pen', 'marker', 'eraser', 'blur', 'line', 'arrow', 'rect', 'circle', 'text'].includes(currentTool);
    
    const cp = document.getElementById('color-picker');
    if (cp) cp.style.display = usesColor ? 'block' : 'none';
    const sw = document.getElementById('size-wrapper');
    if (sw) sw.style.display = usesSize ? 'flex' : 'none';
    const fp = document.getElementById('font-picker');
    if (fp) fp.style.display = currentTool === 'text' ? 'block' : 'none';
    const bb = document.getElementById('btn-bold');
    if (bb) bb.style.display = currentTool === 'text' ? 'flex' : 'none';
    const sep = document.getElementById('props-sep');
    if (sep) sep.style.display = (usesColor || usesSize || currentTool === 'text') ? 'block' : 'none';
  }
}

function updateZoomUI(e) {
  const wrapper = document.getElementById('preview-scroll-wrapper');
  const img = document.getElementById('shot-preview');
  if (!img || !wrapper) return;

  // 1. Calculate center point (mouse or screen center) and its percentage within the image before zooming
  const imgRect = img.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();

  let targetX = (e && e.clientX !== undefined) ? e.clientX : wrapperRect.left + wrapperRect.width / 2;
  let targetY = (e && e.clientY !== undefined) ? e.clientY : wrapperRect.top + wrapperRect.height / 2;

  const ratioX = (targetX - imgRect.left) / imgRect.width;
  const ratioY = (targetY - imgRect.top) / imgRect.height;

  // 2. Apply zoom to the image and update dimensions
  img.style.height = (baseImgHeight * currentZoom) + 'px';
  img.style.maxWidth = currentZoom > 1 ? 'none' : '100%';
  resizeEditorCanvas();

  // 3. Adjust scroll bar to keep focus point in the same place on the screen
  const newImgRect = img.getBoundingClientRect();
  wrapper.scrollLeft += (newImgRect.left + (ratioX * newImgRect.width)) - targetX;
  wrapper.scrollTop += (newImgRect.top + (ratioY * newImgRect.height)) - targetY;
}

function fitImageToContainer() {
  if (!originalCanvas) return;
  const wrapper = document.getElementById('preview-scroll-wrapper');
  if (!wrapper) return;
  
  if (isWindowMaximized) {
    const availW = wrapper.clientWidth - 20;
    const availH = wrapper.clientHeight - 20;
    const scale = Math.min(availW / originalCanvas.width, availH / originalCanvas.height);
    baseImgHeight = originalCanvas.height * scale;
  } else {
    baseImgHeight = 130;
  }
  currentZoom = 1;
  updateZoomUI();
}

function resizeEditorCanvas() {
  const previewImg = document.getElementById('shot-preview');
  if (editCanvasOverlay && previewImg && previewImg.clientWidth > 0) {
    editCanvasOverlay.width = previewImg.clientWidth;
    editCanvasOverlay.height = previewImg.clientHeight;
    editCanvasOverlay.style.left = previewImg.offsetLeft + 'px';
    editCanvasOverlay.style.top = previewImg.offsetTop + 'px';
    if (currentZoom === 1) baseCanvasWidth = editCanvasOverlay.width;
    redrawHistory();
  }
}

window.addEventListener('resize', () => {
  if (isWindowMaximized && originalCanvas && currentZoom === 1) {
    const wrapper = document.getElementById('preview-scroll-wrapper');
    if (wrapper) {
      const availW = wrapper.clientWidth - 20;
      const availH = wrapper.clientHeight - 20;
      const scale = Math.min(availW / originalCanvas.width, availH / originalCanvas.height);
      baseImgHeight = originalCanvas.height * scale;
      const img = document.getElementById('shot-preview');
      if (img) img.style.height = (baseImgHeight * currentZoom) + 'px';
    }
  }
  resizeEditorCanvas();
});

function getMousePos(e) {
  const rect = editCanvasOverlay.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function findShapeAt(px, py, w, h) {
  const tol = 15; // Tolerance for hit detection (in pixels)
  for (let i = editHistory.length - 1; i >= 0; i--) {
    const shape = editHistory[i];
    if (shape.points) {
      for (let j = 0; j < shape.points.length; j++) {
        const pt = shape.points[j];
        if (Math.hypot(px - pt.x * w, py - pt.y * h) <= tol) return i;
      }
    } else if (shape.text !== undefined) {
      const sx = shape.x * w;
      const sy = shape.y * h;
      const tw = (shape.text.length + 2) * shape.size * 2.5; 
      const th = shape.size * 4 * 1.2;
      if (px >= sx && px <= sx + tw && py >= sy && py <= sy + th) return i;
    } else {
      const sx1 = shape.x1 * w, sy1 = shape.y1 * h;
      const sx2 = shape.x2 * w, sy2 = shape.y2 * h;
      if (shape.tool === 'rect' || shape.tool === 'circle' || shape.tool === 'blur') {
        const rx = Math.min(sx1, sx2), ry = Math.min(sy1, sy2);
        const rw = Math.abs(sx2 - sx1), rh = Math.abs(sy2 - sy1);
        if (px >= rx - tol && px <= rx + rw + tol && py >= ry - tol && py <= ry + rh + tol) return i;
      } else {
        if (distToSegment(px, py, sx1, sy1, sx2, sy2) <= tol) return i;
      }
    }
  }
  return -1;
}

function startDraw(e) {
  if (isSpaceDown) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    const wrapper = document.getElementById('preview-scroll-wrapper');
    if (wrapper) {
      panScrollLeft = wrapper.scrollLeft;
      panScrollTop = wrapper.scrollTop;
    }
    editCanvasOverlay.style.cursor = 'grabbing';
    return;
  }
  if (currentTool === 'move') {
    const pos = getMousePos(e);
    selectedShapeIndex = findShapeAt(pos.x, pos.y, editCanvasOverlay.width, editCanvasOverlay.height);
    if (selectedShapeIndex !== -1) {
      isDrawing = true;
      lastMouseX = pos.x;
      lastMouseY = pos.y;
    }
    return;
  }
  if (currentTool === 'text') {
    if (document.getElementById('text-tool-input')) return;
    const pos = getMousePos(e);
    spawnTextInput(pos.x, pos.y);
    return;
  }
  isDrawing = true;
  const pos = getMousePos(e);
  if (currentTool === 'pen' || currentTool === 'marker' || currentTool === 'eraser') {
    currentPoints = [{ x: pos.x / editCanvasOverlay.width, y: pos.y / editCanvasOverlay.height }];
  } else {
    drawStartX = pos.x;
    drawStartY = pos.y;
  }
}

function draw(e) {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    const wrapper = document.getElementById('preview-scroll-wrapper');
    if (wrapper) {
      wrapper.scrollLeft = panScrollLeft - dx;
      wrapper.scrollTop = panScrollTop - dy;
    }
    return;
  }
  if (currentTool === 'move') {
    if (!isDrawing || selectedShapeIndex === -1) return;
    const pos = getMousePos(e);
    const dx = (pos.x - lastMouseX) / editCanvasOverlay.width;
    const dy = (pos.y - lastMouseY) / editCanvasOverlay.height;
    
    const shape = editHistory[selectedShapeIndex];
    if (shape.points) {
      shape.points.forEach(p => { p.x += dx; p.y += dy; });
    } else if (shape.text !== undefined) {
      shape.x += dx; shape.y += dy;
    } else {
      shape.x1 += dx; shape.y1 += dy;
      shape.x2 += dx; shape.y2 += dy;
    }
    
    lastMouseX = pos.x;
    lastMouseY = pos.y;
    redrawHistory();
    return;
  }
  if (!isDrawing || currentTool === 'text') return;
  const pos = getMousePos(e);
  redrawHistory(); // Clear and redraw history to preview line
  
  const ctx = editCanvasOverlay.getContext('2d');
  if (currentTool === 'pen' || currentTool === 'marker' || currentTool === 'eraser') {
    currentPoints.push({ x: pos.x / editCanvasOverlay.width, y: pos.y / editCanvasOverlay.height });
    drawFreehand(ctx, currentTool, currentColor, currentSize, currentPoints, editCanvasOverlay.width, editCanvasOverlay.height, currentZoom);
  } else {
    drawShape(ctx, currentTool, currentColor, currentSize, drawStartX, drawStartY, pos.x, pos.y, currentZoom);
  }
}

function endDraw(e) {
  if (isPanning) {
    isPanning = false;
    if (editCanvasOverlay) {
      editCanvasOverlay.style.cursor = isSpaceDown ? 'grab' : (currentTool === 'move' ? 'move' : (currentTool === 'text' ? 'text' : 'crosshair'));
    }
    return;
  }
  if (currentTool === 'move') {
    if (isDrawing) {
      isDrawing = false;
      selectedShapeIndex = -1;
      updateFinalScreenshot();
    }
    return;
  }
  if (!isDrawing || currentTool === 'text') return;
  isDrawing = false;
  const pos = getMousePos(e);
  
  if (editHistory.length > 30) {
    const oldest = editHistory.shift();
    if (originalCanvas) {
      const ctx = originalCanvas.getContext('2d');
      const scaleX = originalCanvas.width;
      const scaleY = originalCanvas.height;
      const lineScale = Math.max(originalCanvas.width / (baseCanvasWidth || editCanvasOverlay.width || 380), 1);
      if (oldest.tool === 'image') {
        ctx.drawImage(oldest.img, oldest.x * scaleX, oldest.y * scaleY, oldest.w * scaleX, oldest.h * scaleY);
      } else if (oldest.tool === 'pen' || oldest.tool === 'marker' || oldest.tool === 'eraser') {
        drawFreehand(ctx, oldest.tool, oldest.color, oldest.size, oldest.points, scaleX, scaleY, lineScale);
      } else if (oldest.tool === 'text') {
        drawTextNode(ctx, oldest.color, oldest.size, oldest.font, oldest.text, oldest.x * scaleX, oldest.y * scaleY, lineScale, oldest.bold);
      } else {
        drawShape(ctx, oldest.tool, oldest.color, oldest.size, oldest.x1 * scaleX, oldest.y1 * scaleY, oldest.x2 * scaleX, oldest.y2 * scaleY, lineScale);
      }
    }
  }
  
  if (currentTool === 'pen' || currentTool === 'marker' || currentTool === 'eraser') {
    if (currentPoints.length > 1) {
      editHistory.push({ tool: currentTool, color: currentColor, size: currentSize, points: currentPoints });
      redoHistory = [];
      updateFinalScreenshot();
    }
    currentPoints = [];
  } else {
    if (Math.abs(pos.x - drawStartX) > 2 || Math.abs(pos.y - drawStartY) > 2) {
      editHistory.push({
        tool: currentTool,
        color: currentColor,
        size: currentSize,
        x1: drawStartX / editCanvasOverlay.width,
        y1: drawStartY / editCanvasOverlay.height,
        x2: pos.x / editCanvasOverlay.width,
        y2: pos.y / editCanvasOverlay.height
      });
      redoHistory = [];
      updateFinalScreenshot();
    }
  }
  redrawHistory();
}

function spawnTextInput(x, y) {
  const previewContainer = editCanvasOverlay.parentElement;
  const input = document.createElement('input');
  input.id = 'text-tool-input';
  input.type = 'text';
  input.style.position = 'absolute';
  input.style.left = (editCanvasOverlay.offsetLeft + x) + 'px';
  input.style.top = (editCanvasOverlay.offsetTop + y) + 'px';
  input.style.color = currentColor;
  input.style.fontSize = (currentSize * 4 * currentZoom) + 'px';
  input.style.fontFamily = currentFont;
  input.style.fontWeight = currentTextBold ? 'bold' : 'normal';
  input.style.background = 'transparent';
  input.style.border = '1px dashed ' + currentColor;
  input.style.outline = 'none';
  input.style.padding = '0';
  input.style.margin = '0';
  input.style.zIndex = '1000';
  input.style.minWidth = '50px';
  
  input.addEventListener('input', function() {
    this.style.width = ((this.value.length + 2) * currentSize * 2.5 * currentZoom) + 'px';
  });
  
  const commitText = () => {
    if (input.parentNode) {
      const val = input.value.trim();
      if (val) {
        editHistory.push({
          tool: 'text',
          color: currentColor,
          size: currentSize,
          font: currentFont,
          bold: currentTextBold,
          text: val,
          x: x / editCanvasOverlay.width,
          y: y / editCanvasOverlay.height
        });
        redoHistory = [];
        updateFinalScreenshot();
        redrawHistory();
      }
      input.parentNode.removeChild(input);
    }
  };

  input.addEventListener('blur', commitText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      commitText();
    }
  });

  previewContainer.appendChild(input);
  setTimeout(() => input.focus(), 10);
}

function drawTextNode(ctx, color, size, font, text, x, y, scale = 1, isBold = false) {
  ctx.fillStyle = color;
  ctx.font = `${isBold ? 'bold ' : ''}${size * 4 * scale}px ${font || 'Arial'}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function drawFreehand(ctx, tool, color, size, points, w, h, scale = 1) {
  if (points.length < 2) return;
  ctx.beginPath();
  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = size * scale * 3; // Make eraser slightly wider
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else if (tool === 'marker') {
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = size * scale * 3;
    ctx.strokeStyle = color;
  } else {
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = size * scale;
    ctx.strokeStyle = color;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(points[0].x * w, points[0].y * h);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * w, points[i].y * h);
  }
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  if (tool === 'eraser') ctx.globalCompositeOperation = 'source-over';
}

function drawShape(ctx, tool, color, size, x1, y1, x2, y2, scale = 1) {
  ctx.beginPath();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tool === 'blur') {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    if (rw > 0 && rh > 0 && originalCanvas) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.filter = `blur(${(size * 2 + 2) * scale}px)`;
      ctx.drawImage(originalCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  } else if (tool === 'rect') {
    ctx.strokeStyle = color;
    ctx.lineWidth = size * scale;
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    ctx.strokeRect(rx, ry, rw, rh);
  } else if (tool === 'circle') {
    ctx.strokeStyle = color;
    ctx.lineWidth = size * scale;
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (tool === 'line') {
    ctx.strokeStyle = color;
    ctx.lineWidth = size * scale;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (tool === 'arrow') {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size * scale;
    
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = (12 + size) * scale;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(x2, y2);
    ctx.fill();
  }
}

function redrawHistory() {
  if (!editCanvasOverlay) return;
  const ctx = editCanvasOverlay.getContext('2d');
  ctx.clearRect(0, 0, editCanvasOverlay.width, editCanvasOverlay.height);
  
  editHistory.forEach(step => {
    if (step.tool === 'image') {
      ctx.drawImage(step.img, step.x * editCanvasOverlay.width, step.y * editCanvasOverlay.height, step.w * editCanvasOverlay.width, step.h * editCanvasOverlay.height);
    } else if (step.tool === 'pen' || step.tool === 'marker' || step.tool === 'eraser') {
      drawFreehand(ctx, step.tool, step.color, step.size, step.points, editCanvasOverlay.width, editCanvasOverlay.height, 1);
    } else if (step.tool === 'text') {
      drawTextNode(ctx, step.color, step.size, step.font, step.text, step.x * editCanvasOverlay.width, step.y * editCanvasOverlay.height, 1, step.bold);
    } else {
      drawShape(
        ctx,
        step.tool,
        step.color,
        step.size,
        step.x1 * editCanvasOverlay.width,
        step.y1 * editCanvasOverlay.height,
        step.x2 * editCanvasOverlay.width,
        step.y2 * editCanvasOverlay.height,
            currentZoom
      );
    }
  });
  
  if (currentTool === 'move' && selectedShapeIndex !== -1) {
    const shape = editHistory[selectedShapeIndex];
    if (shape && shape.tool === 'image') {
      const sx = shape.x * editCanvasOverlay.width, sy = shape.y * editCanvasOverlay.height;
      const sw = shape.w * editCanvasOverlay.width, sh = shape.h * editCanvasOverlay.height;
      ctx.strokeStyle = '#0cf'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      const hs = 8, hhs = 4;
      const handles = [{x: sx, y: sy}, {x: sx + sw, y: sy}, {x: sx, y: sy + sh}, {x: sx + sw, y: sy + sh}];
      handles.forEach(p => {
        ctx.fillRect(p.x - hhs, p.y - hhs, hs, hs);
        ctx.strokeRect(p.x - hhs, p.y - hhs, hs, hs);
      });
    }
  }
}

function undoEdit() {
  if (editHistory.length === 0) return;
  redoHistory.push(editHistory.pop());
  redrawHistory();
  updateFinalScreenshot();
}

function redoEdit() {
  if (redoHistory.length === 0) return;
  editHistory.push(redoHistory.pop());
  redrawHistory();
  updateFinalScreenshot();
}

window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.id === 'text-tool-input') return;
  const stepActions = document.getElementById('step-actions');
  if (!stepActions || stepActions.style.display !== 'flex') return;
  
  if ((e.key === 'Delete' || e.key === 'Backspace') && currentTool === 'move' && selectedShapeIndex !== -1) {
    e.preventDefault();
    editHistory.splice(selectedShapeIndex, 1);
    redoHistory = []; // Prevent errors on undo
    selectedShapeIndex = -1;
    redrawHistory();
    updateFinalScreenshot();
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    isSpaceDown = true;
    if (editCanvasOverlay && !isPanning) editCanvasOverlay.style.cursor = 'grab';
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      redoEdit();
    } else {
      undoEdit();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redoEdit();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      currentZoom = Math.min(5, currentZoom + 0.25);
      updateZoomUI();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      currentZoom = Math.max(0.5, currentZoom - 0.25);
      updateZoomUI();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      currentZoom = 1;
      updateZoomUI();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    isSpaceDown = false;
    isPanning = false;
    if (editCanvasOverlay) {
      editCanvasOverlay.style.cursor = currentTool === 'move' ? 'move' : (currentTool === 'text' ? 'text' : 'crosshair');
    }
  }
});

window.addEventListener('paste', (e) => {
  const stepActions = document.getElementById('step-actions');
  if (!stepActions || stepActions.style.display !== 'flex') return;
  
  if (!e.clipboardData) return;
  const items = e.clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      loadImageFile(blob);
      e.preventDefault();
      break;
    }
  }
});

window.addEventListener('wheel', (e) => {
  const stepActions = document.getElementById('step-actions');
  if (stepActions && stepActions.style.display === 'flex') {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        currentZoom = Math.min(5, currentZoom + 0.25);
      } else {
        currentZoom = Math.max(0.5, currentZoom - 0.25);
      }
      updateZoomUI(e);
    }
  }
}, { passive: false });

function clearEdit() {
  editHistory = [];
  redoHistory = [];
  redrawHistory();
  updateFinalScreenshot();
}

function updateFinalScreenshot() {
  if (!originalCanvas) return;
  
  const combined = document.createElement('canvas');
  combined.width = originalCanvas.width;
  combined.height = originalCanvas.height;
  const ctx = combined.getContext('2d');
  
  ctx.drawImage(originalCanvas, 0, 0);
  
  // Create a transparent layer for edits so the eraser doesn't erase the original image
  const editLayer = document.createElement('canvas');
  editLayer.width = originalCanvas.width;
  editLayer.height = originalCanvas.height;
  const editCtx = editLayer.getContext('2d');
  
  const scaleX = originalCanvas.width;
  const scaleY = originalCanvas.height;
  const lineScale = Math.max(originalCanvas.width / (baseCanvasWidth || editCanvasOverlay.width || 380), 1);
  
  editHistory.forEach(step => {
    if (step.tool === 'image') {
      editCtx.drawImage(step.img, step.x * scaleX, step.y * scaleY, step.w * scaleX, step.h * scaleY);
    } else if (step.tool === 'pen' || step.tool === 'marker' || step.tool === 'eraser') {
      drawFreehand(editCtx, step.tool, step.color, step.size, step.points, scaleX, scaleY, lineScale);
    } else if (step.tool === 'text') {
      drawTextNode(editCtx, step.color, step.size, step.font, step.text, step.x * scaleX, step.y * scaleY, lineScale, step.bold);
    } else {
      drawShape(
        editCtx,
        step.tool,
        step.color,
        step.size,
        step.x1 * scaleX,
        step.y1 * scaleY,
        step.x2 * scaleX,
        step.y2 * scaleY,
        lineScale
      );
    }
  });
  
  // Merge the final edit layer on top of the original image
  ctx.drawImage(editLayer, 0, 0);
  
  if (settings.shotFormat === 'jpg') {
    currentScreenshot = combined.toDataURL('image/jpeg', 0.95);
  } else {
    currentScreenshot = combined.toDataURL('image/png');
  }
}

async function performCapture(isCrop) {
  setStatus(isCrop ? 'Select area...' : 'Capturing...');
  try {
    if (isCrop) {
      currentCropRect = await window.api.invoke('open-crop-overlay');
      if (!currentCropRect) {
        setStatus('Cancelled', '');
        return;
      }
      setStatus('Capturing...');
      window.api.send('show-crop-border', currentCropRect);
    }

    // Hide the window and give the Windows system 300ms to hide completely
    window.api.send('hide-main-window');
    await new Promise(r => setTimeout(r, 300));

    if (isCrop) window.api.send('hide-crop-border');

    const source = await getScreenSource();
    if (!source) throw new Error('No screen source found');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
        }
      }
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    await new Promise(r => { video.onloadedmetadata = r; });
    video.play();

    await new Promise(r => setTimeout(r, 100));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (isCrop) {
      const scaleX = video.videoWidth / window.screen.width;
      const scaleY = video.videoHeight / window.screen.height;

      canvas.width = Math.round(currentCropRect.w * scaleX);
      canvas.height = Math.round(currentCropRect.h * scaleY);

      ctx.drawImage(
        video,
        Math.round(currentCropRect.x * scaleX),
        Math.round(currentCropRect.y * scaleY),
        Math.round(currentCropRect.w * scaleX),
        Math.round(currentCropRect.h * scaleY),
        0, 0, canvas.width, canvas.height
      );
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
    }

    stream.getTracks().forEach(t => t.stop());

    playSnapSound();

    // Show window again after capturing screenshot successfully
    window.api.send('show-main-window');

    originalCanvas = document.createElement('canvas');
    originalCanvas.width = canvas.width;
    originalCanvas.height = canvas.height;
    originalCanvas.getContext('2d').drawImage(canvas, 0, 0);
    
    editHistory = [];
    redoHistory = [];
    currentTool = 'pen';
    currentPoints = [];

    if (settings.shotFormat === 'jpg') {
      currentScreenshot = canvas.toDataURL('image/jpeg', 0.95);
    } else {
      currentScreenshot = canvas.toDataURL('image/png');
    }
    
    document.getElementById('step-capture').style.display = 'none';
    document.getElementById('step-actions').style.display = 'flex';
    const donationBanner = document.getElementById('donation-banner');
    if (donationBanner) donationBanner.style.display = 'none';
    
    const previewImg = document.getElementById('shot-preview');
    previewImg.onload = () => {
      baseImgHeight = 130;
      injectEditorUI();
      if (!isWindowMaximized) {
        autoMaximized = true;
        window.api.send('maximize-window');
      } else {
        setTimeout(() => {
          fitImageToContainer();
        }, 100);
      }
    };
    previewImg.src = currentScreenshot;

    setStatus('Screenshot ready', 'ok');

  } catch (e) {
    window.api.send('show-main-window');
    setStatus('Error: ' + e.message, 'err');
  }
}

document.getElementById('btn-capture-full').addEventListener('click', () => performCapture(false));
document.getElementById('btn-capture-crop').addEventListener('click', () => performCapture(true));

document.getElementById('btn-action-save').addEventListener('click', async () => {
  if (!currentScreenshot) return;
  try {
    const payload = {
      dataUrl: currentScreenshot,
      autoSave: settings.autoSave,
      savePath: settings.savePath
    };
    const result = await window.api.invoke('save-screenshot', payload);
    if (result.success) {
      setStatus('Saved ✓', 'ok');
      resetScreenshotUI();
    } else {
      setStatus('Cancelled', '');
    }
  } catch (err) {
    setStatus('Save failed!', 'err');
    console.error('Screenshot save error:', err);
  }
});

document.getElementById('btn-action-copy').addEventListener('click', () => {
  if (!currentScreenshot) return;
  window.api.copyToClipboard(currentScreenshot);
  setStatus('Copied ✓', 'ok');
  resetScreenshotUI();
});

document.getElementById('btn-action-discard').addEventListener('click', () => {
  setStatus('Discarded', '');
  resetScreenshotUI();
});

function resetScreenshotUI() {
  currentScreenshot = null;
  originalCanvas = null;
  editHistory = [];
  redoHistory = [];
  currentTool = 'pen';
  currentZoom = 1;
  baseCanvasWidth = 0;
  currentTextBold = true;
  if (document.getElementById('btn-bold')) document.getElementById('btn-bold').style.opacity = '1';
  selectedShapeIndex = -1;
  lastMouseX = 0;
  lastMouseY = 0;
  currentPoints = [];
  isSpaceDown = false;
  isPanning = false;
  
  const brushCursor = document.getElementById('brush-cursor');
  if (brushCursor) brushCursor.style.display = 'none';

  const tbar = document.getElementById('editor-toolbar');
  const pbar = document.getElementById('editor-properties');
  if(tbar) tbar.style.display = 'none';
  if(pbar) pbar.style.display = 'none';
  if (typeof cropRect !== 'undefined') cropRect = null;
  if (typeof cropUI !== 'undefined' && cropUI) cropUI.style.display = 'none';
  document.getElementById('step-capture').style.display = 'flex';
  document.getElementById('step-actions').style.display = 'none';
  const donationBanner = document.getElementById('donation-banner');
  if (donationBanner) donationBanner.style.display = 'block';
  
  const txtInput = document.getElementById('text-tool-input');
  if (txtInput && txtInput.parentNode) txtInput.parentNode.removeChild(txtInput);
  
  const previewImg = document.getElementById('shot-preview');
  if (previewImg) {
    previewImg.style.height = '130px';
    previewImg.style.maxWidth = '100%';
    previewImg.onload = null;
    previewImg.src = '';
  }
  
  if (editCanvasOverlay) {
    const ctx = editCanvasOverlay.getContext('2d');
    ctx.clearRect(0, 0, editCanvasOverlay.width, editCanvasOverlay.height);
  }
  
  if (autoMaximized && isWindowMaximized) {
    window.api.send('unmaximize-window');
    autoMaximized = false;
  } else {
    adjustWindowSize();
  }
}

// ── RECORDING ─────────────────────────────────────────────────────────────
function updateTimer() {
  timerSeconds++;
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  document.getElementById('rec-timer').textContent = `${m}:${s}`;
}

function setRecStatus(text, isRec = false) {
  const dot = document.getElementById('rec-dot');
  document.getElementById('rec-status-text').textContent = text;
  dot.className = 'rec-dot' + (isRec ? ' recording' : '');
}

document.getElementById('btn-start-rec').addEventListener('click', async () => {
  try {
    const modeInput = document.querySelector('input[name="rec-mode"]:checked');
    const mode = modeInput ? modeInput.value : 'full';
    if (mode === 'crop') {
      currentCropRect = await window.api.invoke('open-crop-overlay');
      if (!currentCropRect) {
        return;
      }
      window.api.send('show-crop-border', currentCropRect);
    }

    // ── Countdown & Hide Window ──────────────────
    if (settings.delay) {
      const overlay = document.getElementById('countdown-overlay');
      const txt = document.getElementById('countdown-text');
      overlay.style.display = 'flex';
      for (let i = 3; i > 0; i--) {
        txt.textContent = i;
        await new Promise(r => setTimeout(r, 1000));
      }
      overlay.style.display = 'none';
    }
    if (settings.hide) {
      window.api.send('hide-main-window');
    }

    const source = await getScreenSource();
    const q = settings.quality;
    const fps = parseInt(settings.fps);
    let w = 1920, h = 1080;
    let bps = 25000000; // 25 Mbps default (1080p) - very high quality
    if (q === '720') { w = 1280; h = 720; bps = 10000000; } // 10 Mbps
    if (q === '2160') { w = 3840; h = 2160; bps = 60000000; } // 60 Mbps (4K)

    if (!source) throw new Error("No screen source found!");

    let desktopStream;
    try {
      desktopStream = await navigator.mediaDevices.getDisplayMedia({
        audio: settings.sys,
        video: {
          width: { ideal: w, max: w },
          height: { ideal: h, max: h },
          frameRate: { ideal: fps, max: fps }
        }
      });
    } catch (err) {
      console.warn("System audio capture failed, retrying with video only...", err);
      desktopStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: w, max: w },
          height: { ideal: h, max: h },
          frameRate: { ideal: fps, max: fps }
        }
      });
    }

    let activeTracks = [...desktopStream.getTracks()];
    let finalStream = desktopStream;

    // ── Audio Mixing (Mic + Sys) ─────────────────
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    let hasAudio = false;

    if (settings.sys && desktopStream.getAudioTracks().length > 0) {
      audioCtx.createMediaStreamSource(new MediaStream([desktopStream.getAudioTracks()[0]])).connect(dest);
      hasAudio = true;
    }

    if (settings.mic) {
      try {
        let audioConstraints = true;
        // If a specific microphone is selected, tell the browser to capture its audio using deviceId
        if (settings.micId && settings.micId !== 'default') {
          audioConstraints = { deviceId: { exact: settings.micId } };
        }
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        if (micStream.getAudioTracks().length > 0) {
          activeTracks.push(...micStream.getTracks());
          audioCtx.createMediaStreamSource(micStream).connect(dest);
          hasAudio = true;
        }
      } catch (err) { console.error('Mic error', err); }
    }

    if (hasAudio) {
      finalStream = new MediaStream([
        ...desktopStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
    }

    // ── Video Crop Processing ────────────────────
    let recordingVideo = null;
    let drawInterval = null;

    if (mode === 'crop') {
      recordingVideo = document.createElement('video');
      recordingVideo.srcObject = new MediaStream([...desktopStream.getVideoTracks()]);
      recordingVideo.muted = true;
      await new Promise(r => { recordingVideo.onloadedmetadata = r; });
      recordingVideo.play();

      const recordingCanvas = document.createElement('canvas');
      const scaleX = recordingVideo.videoWidth / window.screen.width;
      const scaleY = recordingVideo.videoHeight / window.screen.height;

      recordingCanvas.width = Math.round(currentCropRect.w * scaleX);
      recordingCanvas.height = Math.round(currentCropRect.h * scaleY);
      const ctx = recordingCanvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const canvasStream = recordingCanvas.captureStream(fps);
      if (hasAudio) canvasStream.addTrack(dest.stream.getAudioTracks()[0]);
      finalStream = canvasStream;

      function drawLoop() {
        if (!isPaused && recordingVideo && !recordingVideo.paused) {
          ctx.drawImage(
            recordingVideo,
            Math.round(currentCropRect.x * scaleX), Math.round(currentCropRect.y * scaleY), Math.round(currentCropRect.w * scaleX), Math.round(currentCropRect.h * scaleY),
            0, 0, recordingCanvas.width, recordingCanvas.height
          );
        }
        drawInterval = requestAnimationFrame(drawLoop);
      }
      drawInterval = requestAnimationFrame(drawLoop);
    }

    recordedChunks = [];
    const audioBps = 320000; // 320 kbps for high audio quality
    let options = { mimeType: 'video/webm', videoBitsPerSecond: bps, audioBitsPerSecond: audioBps };
    if (settings.format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) {
      options = { mimeType: 'video/mp4', videoBitsPerSecond: bps, audioBitsPerSecond: audioBps };
    }

    await window.api.invoke('rec-start');
    recWritePromise = Promise.resolve();
    mediaRecorder = new MediaRecorder(finalStream, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        const blob = e.data;
        recWritePromise = recWritePromise.then(async () => {
          const arrBuf = await blob.arrayBuffer();
          await window.api.invoke('rec-chunk', arrBuf);
        }).catch(err => console.error("Chunk write error:", err));
      }
    };

    mediaRecorder.onstop = async () => {
      activeTracks.forEach(t => t.stop());
      if (recordingVideo) recordingVideo.pause();
      if (drawInterval) cancelAnimationFrame(drawInterval);
      if (audioCtx.state !== 'closed') audioCtx.close();

      if (mode === 'crop') window.api.send('hide-crop-border');
      
      try {
        window.api.send('show-main-window');
        setRecStatus('Processing...');
        document.getElementById('rec-status').innerHTML = `<span>Finalizing file...</span>`;

        await recWritePromise;
        const segmentPath = await window.api.invoke('rec-stop');

        document.getElementById('rec-status').innerHTML = `<span>Select save location...</span>`;

        const result = await window.api.invoke('save-recording', {
          tempFilePath: segmentPath,
          format: settings.format,
          fps: fps,
          speed: settings.speed,
          pitch: settings.pitch,
          hasAudio: finalStream.getAudioTracks().length > 0,
          autoSave: settings.autoSave,
          savePath: settings.savePath
        });
        
        if (result.success) {
          document.getElementById('rec-status').innerHTML = '<span style="color:var(--green)">Saved ✓</span>';
          setTimeout(() => { document.getElementById('rec-status').innerHTML = ''; }, 3000);
        } else {
          if (result.canceled) {
            document.getElementById('rec-status').innerHTML = '<span style="color:var(--muted)">Cancelled</span>';
            setTimeout(() => { document.getElementById('rec-status').innerHTML = ''; }, 3000);
          } else {
            document.getElementById('rec-status').innerHTML = `<span style="color:var(--red)">Save failed!</span>`;
            if (result.error) console.error("Save/Conversion failed:", result.error);
            setTimeout(() => { document.getElementById('rec-status').innerHTML = ''; }, 5000);
          }
        }
      } catch(err) {
        document.getElementById('rec-status').innerHTML = `<span style="color:var(--red)">Critical save error!</span>`;
        console.error("Critical error in onstop handler:", err);
        setTimeout(() => { document.getElementById('rec-status').innerHTML = ''; }, 5000);
      }
      resetRecUI();
    };

    mediaRecorder.start(500);
    isPaused = false;

    // UI
    timerSeconds = 0;
    document.getElementById('rec-timer').textContent = '00:00';
    timerInterval = setInterval(updateTimer, 1000);

    document.getElementById('btn-start-rec').disabled = true;
    document.getElementById('btn-pause-rec').disabled = false;
    document.getElementById('btn-stop-rec').disabled = false;
    setRecStatus('Recording', true);

  } catch (e) {
    window.api.send('hide-crop-border');
    window.api.send('show-main-window');
    setRecStatus('Error');
    document.getElementById('rec-status').textContent = e.message;
  }
});

document.getElementById('btn-pause-rec').addEventListener('click', () => {
  if (!mediaRecorder) return;

  if (!isPaused) {
    mediaRecorder.pause();
    clearInterval(timerInterval);
    isPaused = true;
    setRecStatus('Paused', false);
    const btn = document.getElementById('btn-pause-rec');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
    btn.title = 'Resume';
  } else {
    mediaRecorder.resume();
    timerInterval = setInterval(updateTimer, 1000);
    isPaused = false;
    setRecStatus('Recording', true);
    const btn = document.getElementById('btn-pause-rec');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    btn.title = 'Pause';
  }
});

document.getElementById('btn-stop-rec').addEventListener('click', async () => {
  if (!mediaRecorder) return;
  clearInterval(timerInterval);
  setRecStatus('Saving...');
  if (isPaused) {
    mediaRecorder.resume(); // Ensure dataavailable fires
  }
  mediaRecorder.stop();
});

function resetRecUI() {
  document.getElementById('btn-start-rec').disabled = false;
  document.getElementById('btn-pause-rec').disabled = true;
  document.getElementById('btn-stop-rec').disabled = true;
  const btn = document.getElementById('btn-pause-rec');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  btn.title = 'Pause';
  setRecStatus('Idle', false);
  mediaRecorder = null;
  recordedChunks = [];
  isPaused = false;
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function saveSettings() {
  const safeGet = (id, fallback) => { const el = document.getElementById(id); return el ? el.value : fallback; };
  settings.theme = safeGet('sel-theme', settings.theme);
  settings.language = safeGet('sel-language', settings.language);
  settings.quality = safeGet('sel-quality', settings.quality);
  settings.fps = safeGet('sel-fps', settings.fps);
  settings.shotFormat = safeGet('sel-shot-format', settings.shotFormat);
  settings.format = safeGet('sel-format', settings.format);
  settings.speed = safeGet('sel-speed', settings.speed);
  settings.pitch = safeGet('sel-pitch', settings.pitch);
  settings.micId = safeGet('sel-mic', settings.micId);
  settings.webcamId = safeGet('sel-webcam', settings.webcamId);
  settings.hkFull = safeGet('hk-full', settings.hkFull);
  settings.hkCrop = safeGet('hk-crop', settings.hkCrop);
  settings.hkStart = safeGet('hk-start', settings.hkStart);
  settings.hkPause = safeGet('hk-pause', settings.hkPause);
  settings.hkStop = safeGet('hk-stop', settings.hkStop);
  settings.savePath = safeGet('auto-save-path', settings.savePath);
  if (document.getElementById('chk-auto-save')) settings.autoSave = document.getElementById('chk-auto-save').checked;
  if (document.getElementById('chk-sound-effect')) settings.soundEffect = document.getElementById('chk-sound-effect').checked;
  localStorage.setItem('camfast-settings', JSON.stringify(settings));
  sendShortcutsToMain();
  applyTheme(settings.theme);
}

// Auto-save when changing selects or checkboxes
document.querySelectorAll('#panel-settings select, #panel-settings input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', saveSettings);
});

document.getElementById('sel-pitch')?.addEventListener('input', (e) => {
  if (document.getElementById('pitch-val')) document.getElementById('pitch-val').textContent = e.target.value + '%';
  saveSettings();
});

document.getElementById('sel-webcam')?.addEventListener('change', (e) => {
  settings.webcamId = e.target.value;
  saveSettings();
  if (settings.webcam) {
    window.api.send('toggle-webcam', true, settings.webcamId);
  }
});

document.getElementById('btn-browse-path')?.addEventListener('click', async () => {
  const path = await window.api.invoke('select-save-path');
  if (path) {
    if (document.getElementById('auto-save-path')) document.getElementById('auto-save-path').value = path;
    saveSettings();
  }
});


document.querySelectorAll('.hk-input').forEach(input => {
  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Escape') {
      e.target.value = 'None';
      saveSettings();
      return;
    }
    let keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Cmd');
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    let key = e.key.toUpperCase();
    if (key === ' ') key = 'Space';
    else if (key === '+') key = 'Plus';
    keys.push(key);
    e.target.value = keys.join('+');
    saveSettings();
  });
});

document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
  if (!confirm('Are you sure you want to reset all settings to default?')) return;
  
  settings = { 
    theme: 'system', language: 'en', quality: '1080', fps: '30', shotFormat: 'png', format: 'mp4', speed: '1', pitch: '50', micId: 'default', mic: true, webcamId: 'default', webcam: false, sys: true, delay: false, hide: false, stealth: false, autoSave: false, savePath: '', soundEffect: true,
    hkFull: 'Alt+F', hkCrop: 'Alt+C', hkStart: 'Alt+R', hkPause: 'Alt+P', hkStop: 'Alt+S'
  };
  
  // Update UI Inputs
  if (document.getElementById('sel-theme')) document.getElementById('sel-theme').value = settings.theme;
  if (document.getElementById('sel-language')) document.getElementById('sel-language').value = settings.language;
  if (document.getElementById('sel-quality')) document.getElementById('sel-quality').value = settings.quality;
  if (document.getElementById('sel-fps')) document.getElementById('sel-fps').value = settings.fps;
  if (document.getElementById('sel-shot-format')) document.getElementById('sel-shot-format').value = settings.shotFormat;
  if (document.getElementById('sel-format')) document.getElementById('sel-format').value = settings.format;
  if (document.getElementById('sel-speed')) document.getElementById('sel-speed').value = settings.speed;
  if (document.getElementById('sel-pitch')) document.getElementById('sel-pitch').value = settings.pitch;
  if (document.getElementById('pitch-val')) document.getElementById('pitch-val').textContent = settings.pitch + '%';
  if (document.getElementById('sel-mic')) document.getElementById('sel-mic').value = settings.micId;
  if (document.getElementById('sel-webcam')) document.getElementById('sel-webcam').value = settings.webcamId;
  if (document.getElementById('hk-full')) document.getElementById('hk-full').value = settings.hkFull;
  if (document.getElementById('hk-crop')) document.getElementById('hk-crop').value = settings.hkCrop;
  if (document.getElementById('hk-start')) document.getElementById('hk-start').value = settings.hkStart;
  if (document.getElementById('hk-pause')) document.getElementById('hk-pause').value = settings.hkPause;
  if (document.getElementById('hk-stop')) document.getElementById('hk-stop').value = settings.hkStop;
  if (document.getElementById('auto-save-path')) document.getElementById('auto-save-path').value = settings.savePath;
  if (document.getElementById('chk-auto-save')) document.getElementById('chk-auto-save').checked = settings.autoSave;
  if (document.getElementById('chk-sound-effect')) document.getElementById('chk-sound-effect').checked = settings.soundEffect;
  
  localStorage.setItem('camfast-settings', JSON.stringify(settings));
  applyTheme(settings.theme);
  sendShortcutsToMain();
  updateToggleUI();
  window.api.send('set-stealth-mode', settings.stealth);
  window.api.send('toggle-webcam', settings.webcam, settings.webcamId);
});

document.getElementById('paypal-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.send('open-external', 'https://paypal.me/SHTRIANGLE');
});

document.getElementById('github-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.api.send('open-external', 'https://github.com/soufiancode');
});

// ── Theme logic ───────────────────────────────────────────────────────────
const darkThemeMq = window.matchMedia("(prefers-color-scheme: dark)");
darkThemeMq.addEventListener("change", () => {
  if (settings.theme === 'system') applyTheme('system');
});

function applyTheme(theme) {
  let isDark = true;
  if (theme === 'dark') isDark = true;
  else if (theme === 'light') isDark = false;
  else isDark = darkThemeMq.matches;

  document.documentElement.classList.toggle('light-theme', !isDark);
}
