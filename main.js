const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { getAllSessions, onSessionsChanged, shutdown: shutdownMediaSessions } = require('windows-media-sessions');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { autoUpdater } = require('electron-updater');
// Keep the same profile directory used before packaging so libraries and settings survive installation.
app.setPath('userData', path.join(app.getPath('appData'), 'tisma-place-launcher'));
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
function sendUpdateStatus(status, details = {}) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status', { status, ...details }); }
function configureAutoUpdates() { if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return; autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking')); autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version })); autoUpdater.on('update-not-available', () => sendUpdateStatus('current')); autoUpdater.on('download-progress', progress => sendUpdateStatus('downloading', { percent: Math.round(progress.percent || 0) })); autoUpdater.on('update-downloaded', info => sendUpdateStatus('downloaded', { version: info.version })); autoUpdater.on('error', error => { console.error('Vérification de mise à jour impossible :', error.message); sendUpdateStatus('error'); }); setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000); }
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('updates:check', async () => { if (!app.isPackaged) return { status: 'development' }; if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return { status: 'not-configured' }; try { await autoUpdater.checkForUpdates(); return { status: 'checking' }; } catch (error) { console.error('Vérification de mise à jour impossible :', error.message); return { status: 'error' }; } });
ipcMain.handle('updates:download', async () => { try { await autoUpdater.downloadUpdate(); return { status: 'downloading' }; } catch (error) { console.error('Téléchargement de mise à jour impossible :', error.message); return { status: 'error' }; } });
ipcMain.handle('updates:install', () => { autoUpdater.quitAndInstall(false, true); return true; });
const COVER_LOOKUP_VERSION = 2;
let mainWindow = null, tray = null;
function showMainWindow() { if (!mainWindow || mainWindow.isDestroyed()) return; if (tray && !tray.isDestroyed()) tray.setToolTip('Tisma Place'); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
function hideMainWindowToTray() { if (tray && !tray.isDestroyed()) tray.setToolTip('Tisma Place — jeu en cours'); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); }
function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'assets', 'tisma-place.ico'));
  tray.setToolTip('Tisma Place');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Tisma Place', click: showMainWindow },
    { label: 'Masquer Tisma Place', click: hideMainWindowToTray },
    { type: 'separator' },
    { label: 'Quitter Tisma Place', click: () => app.quit() },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}
function restoreAfterGame() { if (activeSessions.size === 0) showMainWindow(); }
function createWindow() { const win = new BrowserWindow({ width: 1440, height: 920, minWidth: 1080, minHeight: 720, backgroundColor: '#090912', title: 'TISMA PLACE', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: true } }); mainWindow = win; win.on('closed', () => { if (mainWindow === win) mainWindow = null; }); win.loadFile('index.html'); win.webContents.once('did-finish-load', () => { initializeMediaTracking(); }); }
const libraryPath = () => path.join(app.getPath('userData'), 'library.json');
const collectionsPath = () => path.join(app.getPath('userData'), 'collections.json');
const collectionCoversPath = () => path.join(app.getPath('userData'), 'collection-covers.json');
const steamCredentialsPath = () => path.join(app.getPath('userData'), 'steam-credentials.bin');
const activeSessions = new Map();
const steamAchievementCache = new Map();
function readLibrary() { try { return JSON.parse(fs.readFileSync(libraryPath(), 'utf8')); } catch { return []; } }
function writeLibrary(games) {
  const merged = [], byTitle = new Map();
  for (const game of games) {
    const title = normalizeTitle(game.name || '');
    const matches = byTitle.get(title) || [];
    const existingIndex = matches.find(index => !(merged[index].steamAppId && game.steamAppId && String(merged[index].steamAppId) !== String(game.steamAppId)));
    const existing = existingIndex === undefined ? null : merged[existingIndex];
    if (!existing) {
      byTitle.set(title, [...matches, merged.length]);
      merged.push(game);
      continue;
    }
    if (!existing.cover && game.cover) existing.cover = game.cover; if (existing.collectionOrder === undefined && Number.isFinite(Number(game.collectionOrder))) existing.collectionOrder = Number(game.collectionOrder);
    if (!existing.launchArgs && game.launchArgs) existing.launchArgs = game.launchArgs;
    if (!existing.companionExecutable && game.companionExecutable) existing.companionExecutable = game.companionExecutable;
    existing.steamAppId ||= game.steamAppId;
    if ((!existing.executable || !fs.existsSync(existing.executable)) && game.executable && fs.existsSync(game.executable)) { existing.executable = game.executable; existing.workingDirectory = game.workingDirectory || path.dirname(game.executable); }
    if (!existing.collection && game.collection) existing.collection = game.collection; existing.tags = [...new Set([...(Array.isArray(existing.tags) ? existing.tags : []), ...(Array.isArray(game.tags) ? game.tags : [])])].slice(0, 20);
    if (!existing.genre || existing.genre === 'À classer') existing.genre = game.genre;
    existing.favorite ||= Boolean(game.favorite);
    existing.lastPlayed = Math.max(Number(existing.lastPlayed) || 0, Number(game.lastPlayed) || 0) || undefined;
    existing.localPlaytimeSeconds = Math.max(Number(existing.localPlaytimeSeconds) || 0, Number(game.localPlaytimeSeconds) || 0); existing.launchCount = Math.max(Number(existing.launchCount) || 0, Number(game.launchCount) || 0); existing.playSessions = [...new Map([...(Array.isArray(existing.playSessions) ? existing.playSessions : []), ...(Array.isArray(game.playSessions) ? game.playSessions : [])].filter(session => Number.isFinite(Number(session?.startedAt)) && Number.isFinite(Number(session?.seconds))).map(session => [Number(session.startedAt), { startedAt: Number(session.startedAt), seconds: Math.max(0, Math.floor(Number(session.seconds))) }])).values()].sort((a,b)=>a.startedAt-b.startedAt).slice(-120);
    existing.steamPlaytimeMinutes = Math.max(Number(existing.steamPlaytimeMinutes) || 0, Number(game.steamPlaytimeMinutes) || 0);
    existing.notes ||= game.notes;
    existing.status ||= game.status;
  }
  const file = libraryPath();
  try {
    if (fs.existsSync(file)) {
      const backupDirectory = path.join(app.getPath('userData'), 'backups');
      fs.mkdirSync(backupDirectory, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const backupFile = path.join(backupDirectory, `auto-${day}.json`);
      if (!fs.existsSync(backupFile)) writeJsonAtomically(backupFile, { format: 'tisma-place-autosave', createdAt: new Date().toISOString(), games: readLibrary(), collections: readCollections() });
    }
  } catch (error) { console.warn('Sauvegarde automatique indisponible:', error.message); }
  writeJsonAtomically(file, merged);
  return merged;
}
function readCollections() { try { const data = JSON.parse(fs.readFileSync(collectionsPath(), 'utf8')); return Array.isArray(data) ? data.filter(item => typeof item === 'string') : []; } catch { return []; } }
function writeCollections(items) { fs.writeFileSync(collectionsPath(), JSON.stringify(items, null, 2)); return items; }
function readCollectionCovers() { try { const data = JSON.parse(fs.readFileSync(collectionCoversPath(), 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([name, url]) => typeof name === 'string' && typeof url === 'string')) : {}; } catch { return {}; } }
function writeCollectionCovers(covers) { writeJsonAtomically(collectionCoversPath(), covers); return covers; }
function removeCollectionCoverAsset(name, covers = readCollectionCovers()) { const url = covers[name]; try { const target = path.resolve(fileURLToPath(url)); const directory = path.resolve(path.join(app.getPath('userData'), 'collection-covers')); if (target.startsWith(directory + path.sep) && fs.existsSync(target)) fs.unlinkSync(target); } catch {} delete covers[name]; return covers; }

const backupFormat = 'tisma-place-backup';
const backupPreferenceKeys = ['tisma-theme', 'tisma-profile-name', 'tisma-glow', 'tisma-wallpaper', 'tisma-collection-icons', 'tisma-home-music', 'tisma-home-continue', 'tisma-home-feature', 'tisma-home-stats'];
function cleanPreferences(value) { const result = {}; for (const key of backupPreferenceKeys) if (typeof value?.[key] === 'string') { if (key === 'tisma-collection-icons') { try { const parsed = JSON.parse(value[key]); const icons = Object.fromEntries(Object.entries(parsed).filter(([name, icon]) => typeof name === 'string' && name.length <= 24 && typeof icon === 'string' && icon.length <= 8).slice(0, 500)); result[key] = JSON.stringify(icons); } catch { result[key] = '{}'; } } else result[key] = value[key].slice(0, 80); } return result; }
function createBackupPayload(preferences = {}) {
  const coverDirectory = path.join(app.getPath('userData'), 'covers'); const coverAssets = Object.create(null); let totalCoverBytes = 0, coverLimitExceeded = false;
  const games = readLibrary().map(game => { const copy = { ...game }; delete copy.sessionStartedAt; delete copy.missingExecutable;
    if (typeof game.cover === 'string' && game.cover.startsWith('file:')) { try { const coverPath = path.resolve(fileURLToPath(game.cover)); const relative = path.relative(coverDirectory, coverPath); if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(coverPath)) { const stat = fs.statSync(coverPath); if (stat.isFile() && stat.size <= 15 * 1024 * 1024) { const key = path.basename(coverPath), extension = path.extname(key).toLowerCase(); if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) { if (totalCoverBytes + stat.size > 170 * 1024 * 1024) coverLimitExceeded = true; else { totalCoverBytes += stat.size; coverAssets[key] = { extension, data: fs.readFileSync(coverPath).toString('base64') }; copy.coverAssetKey = key; copy.cover = ''; } } } } } catch {} }
    else if (typeof game.cover === 'string' && !/^https?:\/\//i.test(game.cover)) copy.cover = '';
    return copy;
  });
  const collectionCovers = Object.create(null), collectionDirectory = path.join(app.getPath('userData'), 'collection-covers');
  for (const [name, url] of Object.entries(readCollectionCovers())) { if (!readCollections().includes(name) || typeof url !== 'string' || !url.startsWith('file:')) continue; try { const coverPath = path.resolve(fileURLToPath(url)), relative = path.relative(collectionDirectory, coverPath); if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(coverPath)) continue; const stat = fs.statSync(coverPath), key = 'collection-' + path.basename(coverPath), extension = path.extname(key).toLowerCase(); if (!stat.isFile() || stat.size > 15 * 1024 * 1024 || !['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) continue; if (totalCoverBytes + stat.size > 170 * 1024 * 1024) coverLimitExceeded = true; else { totalCoverBytes += stat.size; coverAssets[key] = { extension, data: fs.readFileSync(coverPath).toString('base64') }; collectionCovers[name] = key; } } catch {} }
  if (coverLimitExceeded) throw new Error('Les jaquettes dépassent 170 Mo. Retire quelques jaquettes avant de créer la sauvegarde.');
  return { format: backupFormat, version: 1, createdAt: new Date().toISOString(), appVersion: app.getVersion(), games, collections: readCollections(), preferences: cleanPreferences(preferences), coverAssets, collectionCovers };
}
function writeJsonAtomically(file, value) { const temporary = file + '.' + crypto.randomUUID() + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file); }
function validateBackup(payload) {
  if (!payload || payload.format !== backupFormat || payload.version !== 1 || !Array.isArray(payload.games) || !Array.isArray(payload.collections)) throw new Error('Ce fichier n’est pas une sauvegarde Tisma Place compatible.');
  if (payload.games.length > 5000 || payload.collections.length > 500) throw new Error('Cette sauvegarde contient trop d’éléments.');
  const assets = payload.coverAssets && typeof payload.coverAssets === 'object' && !Array.isArray(payload.coverAssets) ? payload.coverAssets : {}; const cleanAssets = Object.create(null); let totalBytes = 0;
  for (const [key, asset] of Object.entries(assets)) { if (!/^[\w.-]{1,180}$/.test(key) || !asset || !['.png', '.jpg', '.jpeg', '.webp'].includes(asset.extension) || typeof asset.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('Une jaquette de la sauvegarde est invalide.'); const bytes = Buffer.from(asset.data, 'base64'); if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Une jaquette dépasse la taille autorisée.'); totalBytes += bytes.length; if (totalBytes > 170 * 1024 * 1024) throw new Error('Les jaquettes de la sauvegarde dépassent 170 Mo.'); cleanAssets[key] = { extension: asset.extension, bytes }; }
  const ids = new Set(); const games = payload.games.map(game => { if (!game || typeof game.id !== 'string' || !game.id || game.id.length > 128 || typeof game.name !== 'string' || !game.name.trim() || game.name.length > 80 || typeof game.executable !== 'string' || game.executable.length > 4096) throw new Error('Un jeu de la sauvegarde est invalide.'); if (ids.has(game.id)) throw new Error('La sauvegarde contient des jeux en double.'); ids.add(game.id);
    const item = { id: game.id, name: game.name.slice(0, 80), executable: game.executable, args: Array.isArray(game.args) ? game.args.filter(arg => typeof arg === 'string').slice(0, 80).map(arg => arg.slice(0, 2048)) : [], workingDirectory: typeof game.workingDirectory === 'string' ? game.workingDirectory.slice(0, 4096) : path.dirname(game.executable), genre: typeof game.genre === 'string' ? game.genre.slice(0, 30) : 'À classer', source: typeof game.source === 'string' ? game.source.slice(0, 80) : 'Ajout manuel', cover: /^https?:\/\//i.test(game.cover || '') ? game.cover.slice(0, 2048) : '' };
    if (game.coverAssetKey && Object.hasOwn(cleanAssets, game.coverAssetKey)) item.coverAssetKey = game.coverAssetKey; if (typeof game.collection === 'string') item.collection = game.collection.slice(0, 24); if (Array.isArray(game.playSessions)) item.playSessions = game.playSessions.filter(session => Number.isFinite(Number(session?.startedAt)) && Number.isFinite(Number(session?.seconds))).slice(-120).map(session => ({ startedAt: Number(session.startedAt), seconds: Math.max(0, Math.floor(Number(session.seconds))) })); if (Array.isArray(game.tags)) item.tags = [...new Set(game.tags.filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 20); if (typeof game.favorite === 'boolean') item.favorite = game.favorite; if (['À jouer', 'En cours', 'Terminé'].includes(game.status)) item.status = game.status; if (typeof game.notes === 'string') item.notes = game.notes.slice(0, 2000);
    for (const key of ['collectionOrder', 'launchCount', 'steamAppId', 'steamPlaytimeMinutes', 'steamPlaytime2WeeksMinutes', 'localPlaytimeSeconds', 'playtimeSource', 'steamStatsSyncedAt', 'lastPlayed', 'coverLookupAt', 'coverLookupVersion']) if (typeof game[key] === 'string' || (typeof game[key] === 'number' && Number.isFinite(game[key]))) item[key] = game[key]; if (typeof game.launchArgs === 'string') item.launchArgs = game.launchArgs.slice(0, 1000); if (typeof game.companionExecutable === 'string' && path.isAbsolute(game.companionExecutable)) item.companionExecutable = game.companionExecutable.slice(0, 4096); return item; });
  const collections = [...new Set(payload.collections.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 24)))].slice(0, 500); const collectionCovers = Object.create(null); if (payload.collectionCovers && typeof payload.collectionCovers === 'object' && !Array.isArray(payload.collectionCovers)) for (const [name, key] of Object.entries(payload.collectionCovers)) if (collections.includes(name) && typeof key === 'string' && Object.hasOwn(cleanAssets, key)) collectionCovers[name] = key; return { games, collections, coverAssets: cleanAssets, collectionCovers, preferences: cleanPreferences(payload.preferences) };
}
function finishPlaySession(gameId) { const startedAt = activeSessions.get(gameId); if (!startedAt) return; const games = readLibrary(); const game = games.find(item => item.id === gameId); if (game) { const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); game.localPlaytimeSeconds = (Number(game.localPlaytimeSeconds) || 0) + seconds; game.playSessions = [...(Array.isArray(game.playSessions) ? game.playSessions : []), { startedAt, seconds }].slice(-120); delete game.sessionStartedAt; writeLibrary(games); } activeSessions.delete(gameId); }
function clearAbandonedSessions() { const games = readLibrary(); let changed = false; for (const game of games) if (game.sessionStartedAt) { delete game.sessionStartedAt; changed = true; } if (changed) writeLibrary(games); }
function readRegistryValue(key, value) { try { const output = execFileSync('reg.exe', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, timeout: 2500 }); return output.match(new RegExp('^\\s*' + value + '\\s+REG_\\w+\\s+(.+)$', 'im'))?.[1]?.trim(); } catch { return null; } }
function findWallpaperEngineDirectory() {
  const steamInstalls = [readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'), readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'), readRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')].filter(Boolean);
  const libraries = new Set(steamInstalls);
  for (const steamPath of steamInstalls) { try { const vdf = fs.readFileSync(path.join(steamPath, 'config', 'libraryfolders.vdf'), 'utf8'); for (const match of vdf.matchAll(/"path"\s+"((?:\\.|[^"])*)"/gi)) libraries.add(match[1].replace(/\\\\/g, '\\')); } catch {} }
  for (const library of libraries) { const folder = path.join(library, 'steamapps', 'workshop', 'content', '431960'); if (fs.existsSync(folder)) return folder; }
  return fs.existsSync(app.getPath('pictures')) ? app.getPath('pictures') : app.getPath('documents');
}
function seedDefaultCollections() { const marker = path.join(app.getPath('userData'), 'default-collections-seeded'); if (fs.existsSync(marker)) return; if (!readCollections().length) writeCollections(['À jouer', 'En cours', 'Terminés']); fs.writeFileSync(marker, '1'); }
function normalizeTitle(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

async function findSteamAppId(title) {
  const endpoint = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=french&cc=FR`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Recherche Steam indisponible (${response.status})`);
  const results = await response.json();
  const items = Array.isArray(results.items) ? results.items : [];
  const wanted = normalizeTitle(title);
  const exact = items.find(item => item.type === 'app' && normalizeTitle(item.name) === wanted);
  if (exact) return exact.id;
  const compactWanted = wanted.replace(/\s/g, '');
  const compactExact = items.find(item => item.type === 'app' && normalizeTitle(item.name).replace(/\s/g, '') === compactWanted);
  if (compactExact) return compactExact.id;
  const prefixMatch = items.find(item => item.type === 'app' && wanted.length >= 6 && normalizeTitle(item.name).startsWith(`${wanted} `));
  if (prefixMatch) return prefixMatch.id;
  const wantedWords = new Set(wanted.split(' ').filter(word => word.length > 1));
  let best = null, bestScore = 0;
  for (const item of items) {
    if (item.type !== 'app') continue;
    const words = new Set(normalizeTitle(item.name).split(' ').filter(word => word.length > 1));
    const intersection = [...wantedWords].filter(word => words.has(word)).length;
    const score = intersection / Math.max(wantedWords.size, 1);
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return bestScore >= 0.72 ? best.id : null;
}
async function downloadSteamCover(game) {
  try {
    const appId = await findSteamAppId(game.name);
    if (!appId) return false;
    let imageResponse;
    for (const filename of ['library_600x900.jpg', 'capsule_616x353.jpg']) {
      imageResponse = await fetch(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${filename}`, { signal: AbortSignal.timeout(8000) });
      if (imageResponse.ok && (imageResponse.headers.get('content-type') || '').startsWith('image/')) break;
      imageResponse = null;
    }
    if (!imageResponse) return false;
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) return false;
    const directory = path.join(app.getPath('userData'), 'covers');
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${game.id}.jpg`);
    fs.writeFileSync(destination, bytes);
    game.cover = pathToFileURL(destination).href;
    game.steamAppId = appId;
    return true;
  } catch (error) {
    console.warn(`Jaquette indisponible pour ${game.name}:`, error.message);
    return null;
  }
}
ipcMain.handle('window:fullscreen', (event, enabled) => { const win = BrowserWindow.fromWebContents(event.sender); if (!win) return false; win.setFullScreen(Boolean(enabled)); return win.isFullScreen(); });
let mediaKeyWorker = null, mediaSessionsStop = null, currentMediaSnapshot = null, mediaTrackingStarted = false;
let currentVolumeState = { level: 50, muted: false }, mediaWorkerOutput = '';
function startMediaKeyWorker() {
  if (mediaKeyWorker && !mediaKeyWorker.killed) return mediaKeyWorker;
  mediaKeyWorker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'media-key-worker.ps1') : path.join(__dirname, 'media-key-worker.ps1'))], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  mediaKeyWorker.on('error', error => { console.error('Worker des touches multimédias indisponible :', error.message); mediaKeyWorker = null; });
  mediaKeyWorker.stdin.on('error', error => { console.warn('Écriture des touches multimédias impossible :', error.message); });
  mediaKeyWorker.stdout.setEncoding('utf8');
  mediaWorkerOutput = '';
  mediaKeyWorker.stdout.on('data', chunk => {
    mediaWorkerOutput += chunk;
    const lines = mediaWorkerOutput.split(/\r?\n/);
    mediaWorkerOutput = lines.pop() || '';
    for (const line of lines) {
      try {
        const state = JSON.parse(line);
        if (state.type !== 'volume') continue;
        currentVolumeState = state.unavailable ? { unavailable: true, message: state.message } : { level: Math.max(0, Math.min(100, Number(state.level) || 0)), muted: Boolean(state.muted) };
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:volume-state', currentVolumeState);
      } catch { /* Ignore les lignes de diagnostic du processus média. */ }
    }
  });
  mediaKeyWorker.on('exit', () => { mediaKeyWorker = null; });
  return mediaKeyWorker;
}
function publishMediaState(sessions) {
  const current = [...sessions].sort((a, b) => Number(b.playbackStatus === 'playing') - Number(a.playbackStatus === 'playing'))[0];
  currentMediaSnapshot = current ? { id: current.id, title: current.title || '', artist: current.artist || '', albumTitle: current.albumTitle || '', sourceApp: current.sourceAppDisplayName || current.sourceAppUserModelId || '', playbackStatus: current.playbackStatus, controls: current.controls || {}, timeline: current.timeline || {}, thumbnail: current.thumbnail || '' } : null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('media:state', currentMediaSnapshot);
}
function initializeMediaTracking() {
  if (mediaTrackingStarted) return;
  mediaTrackingStarted = true;
  try {
    mediaSessionsStop = onSessionsChanged(publishMediaState);
    getAllSessions().then(publishMediaState).catch(error => { console.warn('Lecture des sessions média Windows indisponible :', error.message); publishMediaState([]); });
  } catch (error) {
    console.warn('Initialisation des sessions média Windows impossible :', error.message);
    publishMediaState([]);
  }
}
ipcMain.handle('media:get-state', () => currentMediaSnapshot);
ipcMain.handle('media:volume-get', () => currentVolumeState);
ipcMain.handle('media:volume-set', (_event, level) => {
  const value = Number(level);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Niveau de volume invalide.');
  const worker = startMediaKeyWorker();
  if (!worker.stdin.writable) throw new Error('Le contrôle du volume Windows est indisponible.');
  worker.stdin.write(JSON.stringify({ command: 'volume:set', value: value / 100 }) + '\n');
  return true;
});
ipcMain.handle('media:volume-mute', () => {
  const worker = startMediaKeyWorker();
  if (!worker.stdin.writable) throw new Error('Le contrôle du volume Windows est indisponible.');
  worker.stdin.write(JSON.stringify({ command: 'volume:toggle-mute' }) + '\n');
  return true;
});
ipcMain.handle('media:command', (_event, command) => {
  if (!['previous', 'playPause', 'next'].includes(command)) throw new Error('Commande multimédia inconnue.');
  const worker = startMediaKeyWorker();
  if (!worker.stdin.writable) throw new Error('Le contrôle multimédia Windows est indisponible.');
  worker.stdin.write(`${command}\n`, error => { if (error) console.warn('Commande multimédia non transmise :', error.message); });
  return true;
});
ipcMain.handle('wallpaper:choose', async () => { const picked = await dialog.showOpenDialog({ title: 'Choisir un fond Wallpaper Engine', defaultPath: findWallpaperEngineDirectory(), properties: ['openFile'], filters: [{ name: 'Vidéos animées (.mp4, .webm)', extensions: ['mp4', 'webm'] }, { name: 'Images fixes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (picked.canceled || !picked.filePaths[0]) return null; const source = picked.filePaths[0], stat = fs.statSync(source); if (stat.size > 1024 * 1024 * 1024) throw new Error('Le fond dépasse 1 Go. Choisis un fichier plus léger.'); const directory = path.join(app.getPath('userData'), 'wallpapers'); fs.mkdirSync(directory, { recursive: true }); const extension = path.extname(source).toLowerCase(); const destination = path.join(directory, crypto.randomUUID() + extension); fs.copyFileSync(source, destination); return { url: pathToFileURL(destination).href, name: path.basename(source) }; });
ipcMain.handle('wallpaper:clear', (_event, wallpaperUrl) => { try { const target = path.resolve(fileURLToPath(wallpaperUrl)); const directory = path.resolve(app.getPath('userData'), 'wallpapers'); if (target.startsWith(directory + path.sep) && fs.existsSync(target)) fs.unlinkSync(target); } catch {} return true; });
ipcMain.handle('backup:export', async (_event, preferences) => {
  const result = await dialog.showSaveDialog({ title: 'Exporter la sauvegarde Tisma Place', defaultPath: path.join(app.getPath('documents'), 'Tisma-Place-sauvegarde.json'), buttonLabel: 'Enregistrer', filters: [{ name: 'Sauvegarde Tisma Place', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify(createBackupPayload(preferences), null, 2)); return { canceled: false, filePath: result.filePath };
});
ipcMain.handle('backup:import', async () => {
  const picked = await dialog.showOpenDialog({ title: 'Choisir une sauvegarde Tisma Place', properties: ['openFile'], filters: [{ name: 'Sauvegarde Tisma Place', extensions: ['json'] }] });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const file = picked.filePaths[0]; if (fs.statSync(file).size > 250 * 1024 * 1024) throw new Error('Le fichier dépasse la taille autorisée de 250 Mo.');
  let payload; try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Impossible de lire ce fichier JSON.'); } const backup = validateBackup(payload);
  const confirm = await dialog.showMessageBox({ type: 'warning', title: 'Restaurer la bibliothèque ?', message: 'La sauvegarde va remplacer les jeux et collections actuellement dans Tisma Place.', detail: backup.games.length + ' jeux · ' + backup.collections.length + ' collections. Une copie de la bibliothèque actuelle sera conservée automatiquement.', buttons: ['Annuler', 'Restaurer la sauvegarde'], defaultId: 0, cancelId: 0, noLink: true });
  if (confirm.response !== 1) return { canceled: true };
  const safetyDirectory = path.join(app.getPath('userData'), 'backups'); fs.mkdirSync(safetyDirectory, { recursive: true }); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const safetyFile = path.join(safetyDirectory, 'avant-restauration-' + stamp + '.json'); fs.writeFileSync(safetyFile, JSON.stringify(createBackupPayload({}), null, 2));
  const oldSafetyFiles = fs.readdirSync(safetyDirectory).filter(name => name.startsWith('avant-restauration-') && name.endsWith('.json')).sort().reverse(); for (const oldFile of oldSafetyFiles.slice(3)) fs.unlinkSync(path.join(safetyDirectory, oldFile));
  const coverDirectory = path.join(app.getPath('userData'), 'covers'); fs.mkdirSync(coverDirectory, { recursive: true });
  const games = backup.games.map(game => { const item = { ...game }; if (item.coverAssetKey && backup.coverAssets[item.coverAssetKey]) { const asset = backup.coverAssets[item.coverAssetKey]; const destination = path.join(coverDirectory, crypto.randomUUID() + asset.extension); fs.writeFileSync(destination, asset.bytes); item.cover = pathToFileURL(destination).href; } delete item.coverAssetKey; delete item.sessionStartedAt; return item; });
  const collectionCoverDirectory = path.join(app.getPath('userData'), 'collection-covers'); fs.mkdirSync(collectionCoverDirectory, { recursive: true }); const restoredCollectionCovers = Object.create(null);
  for (const [name, key] of Object.entries(backup.collectionCovers)) { const asset = backup.coverAssets[key]; if (!asset) continue; const destination = path.join(collectionCoverDirectory, crypto.randomUUID() + asset.extension); fs.writeFileSync(destination, asset.bytes); restoredCollectionCovers[name] = pathToFileURL(destination).href; }
  writeJsonAtomically(libraryPath(), games); writeJsonAtomically(collectionsPath(), backup.collections); writeCollectionCovers(restoredCollectionCovers); return { canceled: false, restored: true, games: games.length, preferences: backup.preferences };
});
ipcMain.handle('backup:restore-auto', async () => {
  const directory = path.join(app.getPath('userData'), 'backups');
  const candidates = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse() : [];
  if (!candidates.length) throw new Error('Aucune sauvegarde automatique disponible pour le moment.');
  const file = path.join(directory, candidates[0]); let payload;
  try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('La dernière sauvegarde automatique est illisible.'); }
  if (payload?.format !== 'tisma-place-autosave' || !Array.isArray(payload.games) || !Array.isArray(payload.collections) || payload.games.length > 5000 || payload.collections.length > 500) throw new Error('La dernière sauvegarde automatique est invalide.');
  const confirm = await dialog.showMessageBox({ type: 'warning', title: 'Restaurer la sauvegarde automatique ?', message: 'La bibliothèque actuelle sera remplacée par sa dernière version sauvegardée.', detail: `${candidates[0]} · ${payload.games.length} jeux. Une copie de l’état actuel sera conservée.`, buttons: ['Annuler', 'Restaurer'], defaultId: 0, cancelId: 0, noLink: true });
  if (confirm.response !== 1) return { canceled: true };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJsonAtomically(path.join(directory, 'avant-auto-restauration-' + stamp + '.json'), createBackupPayload({}));
  writeLibrary(payload.games); writeCollections(payload.collections.filter(item => typeof item === 'string').slice(0, 500));
  return { canceled: false, restored: true, games: payload.games.length };
});
ipcMain.handle('library:get', () => readLibrary().map(game => ({ ...game, missingExecutable: !game.executable || !fs.existsSync(game.executable) })));
ipcMain.handle('collections:get', () => readCollections());
ipcMain.handle('collection:cover:get', () => readCollectionCovers());
ipcMain.handle('collection:cover:choose', async (_event, value) => { const name = String(value || ''); if (!readCollections().includes(name)) throw new Error('Cette collection n’existe plus.'); const picked = await dialog.showOpenDialog({ title: 'Choisir une image pour la collection', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (picked.canceled || !picked.filePaths[0]) return readCollectionCovers(); const source = picked.filePaths[0], extension = path.extname(source).toLowerCase(), stat = fs.statSync(source); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Choisis une image PNG, JPG ou WEBP.'); if (!stat.isFile() || stat.size > 15 * 1024 * 1024) throw new Error('L’image doit faire moins de 15 Mo.'); const directory = path.join(app.getPath('userData'), 'collection-covers'); fs.mkdirSync(directory, { recursive: true }); const destination = path.join(directory, crypto.randomUUID() + extension); fs.copyFileSync(source, destination); const covers = removeCollectionCoverAsset(name); covers[name] = pathToFileURL(destination).href; return writeCollectionCovers(covers); });
ipcMain.handle('collection:cover:clear', (_event, value) => writeCollectionCovers(removeCollectionCoverAsset(String(value || ''))));
ipcMain.handle('collections:set-order', (_event, values) => {
  const current = readCollections();
  if (!Array.isArray(values) || values.length !== current.length || values.some(name => typeof name !== 'string' || !current.includes(name)) || new Set(values).size !== values.length) throw new Error('Ordre des collections invalide.');
  return writeCollections(values);
});

ipcMain.handle('collection:add', (_event, value) => { const name = String(value || '').trim().slice(0, 24); if (!name) throw new Error('Saisis un nom de collection.'); const collections = readCollections(); if (!collections.some(item => item.toLowerCase() === name.toLowerCase())) collections.push(name); return writeCollections(collections); });
ipcMain.handle('collection:rename', (_event, oldValue, newValue) => {
  const oldName = String(oldValue || '').trim();
  const newName = String(newValue || '').trim().slice(0, 24);
  const collections = readCollections();
  if (!collections.includes(oldName)) throw new Error('Cette collection n’existe plus.');
  if (!newName) throw new Error('Saisis un nom de collection.');
  if (collections.some(item => item !== oldName && item.toLowerCase() === newName.toLowerCase())) throw new Error('Une collection porte déjà ce nom.');
  const games = readLibrary();
  games.forEach(game => { if (game.collection === oldName) game.collection = newName; });
  writeLibrary(games);
  const covers = readCollectionCovers(); if (oldName !== newName && covers[oldName]) { covers[newName] = covers[oldName]; delete covers[oldName]; writeCollectionCovers(covers); }
  return writeCollections(collections.map(item => item === oldName ? newName : item));
});
ipcMain.handle('collection:remove', (_event, value) => { const collections = readCollections().filter(item => item !== value); const games = readLibrary(); games.forEach(game => { if (game.collection === value) delete game.collection; }); writeLibrary(games); writeCollectionCovers(removeCollectionCoverAsset(value)); return writeCollections(collections); });
ipcMain.handle('game:set-collection', (_event, id, value) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); const collection = String(value || ''); if (collection && !readCollections().includes(collection)) throw new Error('Cette collection n’existe plus.'); if (collection) game.collection = collection; else delete game.collection; return writeLibrary(games); });
ipcMain.handle('games:bulk-set-collection', (_event, ids, value) => { if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('Sélection de jeux invalide.'); const collection = String(value || ''); if (collection && !readCollections().includes(collection)) throw new Error('Cette collection n’existe plus.'); const games = readLibrary(), selected = games.filter(game => ids.includes(game.id)); if (selected.length !== ids.length) throw new Error('Un ou plusieurs jeux sont introuvables.'); selected.forEach(game => { if (collection) game.collection = collection; else delete game.collection; delete game.collectionOrder; }); return writeLibrary(games); });
ipcMain.handle('games:bulk-update', (_event, ids, action, value) => { if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('Sélection de jeux invalide.'); if (!['status', 'genre', 'tag-add', 'tag-remove'].includes(action)) throw new Error('Action groupée invalide.'); const games = readLibrary(), selected = games.filter(game => ids.includes(game.id)); if (selected.length !== ids.length) throw new Error('Un ou plusieurs jeux sont introuvables.'); const text = String(value || '').trim(); if (action === 'status' && !['À jouer', 'En cours', 'Terminé'].includes(text)) throw new Error('Statut invalide.'); if (action === 'genre' && !text) throw new Error('Choisis un genre.'); if ((action === 'tag-add' || action === 'tag-remove') && !text) throw new Error('Saisis une étiquette.'); selected.forEach(game => { if (action === 'status') game.status = text; else if (action === 'genre') game.genre = text.slice(0, 30); else { const tags = Array.isArray(game.tags) ? game.tags : []; game.tags = action === 'tag-add' ? [...new Set([...tags, text.slice(0, 24)])].slice(0, 20) : tags.filter(tag => tag !== text); } }); return writeLibrary(games); });
ipcMain.handle('games:bulk-remove', (_event, ids) => { if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('Sélection de jeux invalide.'); const games = readLibrary(); if (games.filter(game => ids.includes(game.id)).length !== ids.length) throw new Error('Un ou plusieurs jeux sont introuvables.'); return writeLibrary(games.filter(game => !ids.includes(game.id))); });
ipcMain.handle('game:set-collection-order', (_event, name, ids) => { const games = readLibrary(), members = games.filter(game => game.collection === name); if (!readCollections().includes(name)) throw new Error('Cette collection n’existe plus.'); if (!Array.isArray(ids) || ids.length !== members.length || new Set(ids).size !== ids.length || ids.some(id => !members.some(game => game.id === id))) throw new Error('Ordre de collection invalide.'); ids.forEach((id, index) => { const game = members.find(item => item.id === id); game.collectionOrder = index; }); return writeLibrary(games); });
ipcMain.handle('game:set-genre', (_event, id, value) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); const genre = String(value || '').trim().slice(0, 30); if (!genre) throw new Error('Saisis un genre valide.'); game.genre = genre; return writeLibrary(games); });
ipcMain.handle('game:set-tags', (_event, id, value) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); if (!Array.isArray(value)) throw new Error('Liste d’étiquettes invalide.'); game.tags = [...new Set(value.filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 20); return writeLibrary(games); });
ipcMain.handle('game:set-status', (_event, id, value) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); if (!['À jouer', 'En cours', 'Terminé'].includes(value)) throw new Error('Statut de jeu invalide.'); game.status = value; return writeLibrary(games); });
ipcMain.handle('game:set-notes', (_event, id, value) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); game.notes = String(value || '').slice(0, 2000); return writeLibrary(games); });
ipcMain.handle('game:set-launch-profile', (_event, id, profile) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); const launchArgs = String(profile?.launchArgs || '').trim().slice(0, 1000), companionExecutable = String(profile?.companionExecutable || '').trim(); if (companionExecutable && (!path.isAbsolute(companionExecutable) || !fs.existsSync(companionExecutable) || path.extname(companionExecutable).toLowerCase() !== '.exe')) throw new Error('Choisis un fichier .exe valide pour l’application compagnon.'); game.launchArgs = launchArgs; if (companionExecutable) game.companionExecutable = companionExecutable; else delete game.companionExecutable; return writeLibrary(games); });
ipcMain.handle('game:screenshots', async (_event, id) => { const game = readLibrary().find(item => item.id === id); if (!game) throw new Error('Jeu introuvable.'); const folder = path.join(app.getPath('pictures'), 'Tisma Place', game.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)); fs.mkdirSync(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error('Impossible d’ouvrir le dossier des captures.'); return folder; });
ipcMain.handle('steam:credentials:get', () => ({ configured: fs.existsSync(steamCredentialsPath()) }));
ipcMain.handle('steam:credentials:save', (_event, steamId, apiKey) => { const id = String(steamId || '').trim(); let key = String(apiKey || '').trim(); if (!/^\d{17}$/.test(id)) throw new Error('Le SteamID doit contenir 17 chiffres.'); if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement Windows n’est pas disponible.'); if (!key && fs.existsSync(steamCredentialsPath())) { try { key = JSON.parse(safeStorage.decryptString(fs.readFileSync(steamCredentialsPath()))).apiKey; } catch {} } if (!/^[a-f\d]{32}$/i.test(key)) throw new Error('La clé API Steam doit contenir 32 caractères.'); fs.writeFileSync(steamCredentialsPath(), safeStorage.encryptString(JSON.stringify({ steamId: id, apiKey: key }))); return { configured: true }; });
ipcMain.handle('steam:credentials:clear', () => { try { fs.unlinkSync(steamCredentialsPath()); } catch {} return { configured: false }; });
ipcMain.handle('steam:playtime:sync', async () => { if (!fs.existsSync(steamCredentialsPath())) throw new Error('Connecte ton compte Steam dans les paramètres.'); if (!safeStorage.isEncryptionAvailable()) throw new Error('Impossible de déchiffrer les identifiants Steam sur ce PC.'); let credentials; try { credentials = JSON.parse(safeStorage.decryptString(fs.readFileSync(steamCredentialsPath()))); } catch { throw new Error('Les identifiants Steam ne peuvent pas être lus. Réenregistre-les dans les paramètres.'); } const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'); url.searchParams.set('key', credentials.apiKey); url.searchParams.set('steamid', credentials.steamId); url.searchParams.set('include_appinfo', 'false'); url.searchParams.set('include_played_free_games', 'true'); const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error('Steam ne répond pas. Réessaie plus tard.'); const payload = await response.json(); const records = payload?.response?.games; if (!Array.isArray(records) || !records.length) throw new Error('Steam ne renvoie aucun jeu. Vérifie que les détails de jeux de ton profil sont publics.'); const byId = new Map(records.map(record => [String(record.appid), record])); const games = readLibrary(), syncedAt = Date.now(); let updated = 0; for (const game of games) { const record = game.steamAppId && byId.get(String(game.steamAppId)); if (!record) continue; game.steamPlaytimeMinutes = Number(record.playtime_forever) || 0; game.steamPlaytime2WeeksMinutes = Number(record.playtime_2weeks) || 0; game.localPlaytimeSeconds = 0; if (activeSessions.has(game.id)) { activeSessions.set(game.id, syncedAt); game.sessionStartedAt = syncedAt; } game.playtimeSource = 'steam'; game.steamStatsSyncedAt = syncedAt; updated++; } writeLibrary(games); return { updated }; });
ipcMain.handle('steam:achievements:get', async (_event, appId, forceRefresh = false) => {
  const id = String(appId || '').trim();
  if (!/^\d{1,10}$/.test(id) || Number(id) > 4294967295) throw new Error('Identifiant Steam du jeu invalide. Relance le scan de ta bibliothèque.');
  if (!fs.existsSync(steamCredentialsPath())) throw new Error('Connecte ton compte Steam dans les paramètres.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement Windows n’est pas disponible.');
  let credentials;
  try { credentials = JSON.parse(safeStorage.decryptString(fs.readFileSync(steamCredentialsPath()))); }
  catch { throw new Error('Les identifiants Steam ne peuvent pas être lus. Réenregistre-les dans les paramètres.'); }
  if (!forceRefresh) {
    const cached = steamAchievementCache.get(id);
    if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;
  }
  const makeUrl = (method, version) => {
    const url = new URL(`https://api.steampowered.com/ISteamUserStats/${method}/${version}/`);
    url.searchParams.set('key', credentials.apiKey);
    url.searchParams.set('appid', id);
    url.searchParams.set('l', 'french');
    if (method === 'GetPlayerAchievements') url.searchParams.set('steamid', credentials.steamId);
    return url;
  };
  const fetchJson = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Steam ne répond pas. Réessaie plus tard.');
    return response.json();
  };
  const [schemaPayload, playerPayload] = await Promise.all([
    fetchJson(makeUrl('GetSchemaForGame', 'v2')),
    fetchJson(makeUrl('GetPlayerAchievements', 'v1')),
  ]);
  const schema = schemaPayload?.game?.availableGameStats?.achievements;
  const playerStats = playerPayload?.playerstats;
  if (playerStats?.success === false) throw new Error('Steam ne peut pas lire ces succès. Vérifie que les détails de jeux de ton profil sont publics.');
  if (!Array.isArray(schema)) throw new Error('Steam ne fournit pas la liste des succès pour ce jeu.');
  const unlockedByName = new Map((Array.isArray(playerStats?.achievements) ? playerStats.achievements : []).map(item => [item.apiname, item]));
  const achievements = schema.map(item => {
    const progress = unlockedByName.get(item.name) || {};
    const unlocked = Number(progress.achieved) === 1;
    return {
      name: String(item.displayName || item.name || 'Succès'),
      description: String(item.description || ''),
      icon: String(item.icon || ''),
      iconLocked: String(item.icongray || ''),
      unlocked,
      hidden: Number(item.hidden) === 1,
      unlockedAt: Number(progress.unlocktime) || 0,
    };
  }).sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || (b.unlockedAt - a.unlockedAt) || a.name.localeCompare(b.name, 'fr'));
  const data = { appId: id, total: achievements.length, unlocked: achievements.filter(item => item.unlocked).length, achievements };
  steamAchievementCache.set(id, { savedAt: Date.now(), data });
  return data;
});
ipcMain.handle('game:add', (_event, game) => { if (!game?.name || !game?.executable || !path.isAbsolute(game.executable) || !fs.existsSync(game.executable)) throw new Error('Choisis un fichier de jeu valide.'); const games = readLibrary(); if (games.some(item => item.executable.toLowerCase() === game.executable.toLowerCase())) return games; games.push({ id: crypto.randomUUID(), name: String(game.name).slice(0, 80), executable: game.executable, args: Array.isArray(game.args) ? game.args.filter(arg => typeof arg === 'string') : [], workingDirectory: game.workingDirectory || path.dirname(game.executable), genre: String(game.genre || 'Autre').slice(0, 30), tags: [], status: 'À jouer', cover: '', source: game.source || 'Ajout manuel', steamAppId: game.steamAppId ? String(game.steamAppId) : undefined }); return writeLibrary(games); });
ipcMain.handle('game:remove', (_event, id) => writeLibrary(readLibrary().filter(game => game.id !== id)));
ipcMain.handle('game:toggle-favorite', (_event, id) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable dans la bibliothèque.'); game.favorite = !game.favorite; return writeLibrary(games); });
ipcMain.handle('game:choose-cover', async (_event, id) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable dans la bibliothèque.'); const result = await dialog.showOpenDialog({ title: 'Choisir la jaquette du jeu', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (result.canceled) return games; const source = result.filePaths[0]; const extension = path.extname(source).toLowerCase(); const directory = path.join(app.getPath('userData'), 'covers'); fs.mkdirSync(directory, { recursive: true }); const destination = path.join(directory, `${crypto.randomUUID()}${extension}`); fs.copyFileSync(source, destination); game.cover = pathToFileURL(destination).href; return writeLibrary(games); });
ipcMain.handle('games:fetch-covers', async (_event, force = false) => { const games = readLibrary(); const due = games.filter(game => !game.cover && (force || game.coverLookupVersion !== COVER_LOOKUP_VERSION || !game.coverLookupAt || Date.now() - game.coverLookupAt > 7 * 24 * 60 * 60 * 1000)); let count = 0, failed = 0; for (let index = 0; index < due.length; index += 3) { const batch = due.slice(index, index + 3); const results = await Promise.all(batch.map(async game => { const found = await downloadSteamCover(game); if (found !== null) { game.coverLookupAt = Date.now(); game.coverLookupVersion = COVER_LOOKUP_VERSION; } return found; })); count += results.filter(Boolean).length; failed += results.filter(result => result === null).length; writeLibrary(games); } return { games, count, attempted: due.length, failed }; });
ipcMain.handle('game:choose', async () => { const result = await dialog.showOpenDialog({ title: 'Choisir le jeu à ajouter', properties: ['openFile'], filters: [{ name: 'Applications Windows', extensions: ['exe'] }] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('game:choose-companion', async () => { const result = await dialog.showOpenDialog({ title: 'Choisir une application à ouvrir avec le jeu', properties: ['openFile'], filters: [{ name: 'Applications Windows', extensions: ['exe'] }] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('game:repair', async (_event, id) => { const games = readLibrary(); const game = games.find(item => item.id === id); if (!game) throw new Error('Jeu introuvable dans la bibliothèque.'); const result = await dialog.showOpenDialog({ title: `Retrouver le fichier de ${game.name}`, properties: ['openFile'], filters: [{ name: 'Applications Windows', extensions: ['exe'] }] }); if (result.canceled) return games; game.executable = result.filePaths[0]; game.workingDirectory = path.dirname(game.executable); delete game.missingExecutable; return writeLibrary(games); });
ipcMain.handle('game:launch', async (event, id) => { const appWindow = BrowserWindow.fromWebContents(event.sender); const games = readLibrary(); const game = games.find(item => item.id === id); if (!game || !fs.existsSync(game.executable)) throw new Error('Le fichier du jeu est introuvable.'); if (game.companionExecutable && !fs.existsSync(game.companionExecutable)) throw new Error('L’application compagnon est introuvable. Modifie son chemin dans la fiche du jeu.'); const extraArgs = String(game.launchArgs || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map(arg => arg.replace(/^"|"$/g, '')) || []; const args = [...(Array.isArray(game.args) ? game.args : []), ...extraArgs]; game.lastPlayed = Date.now(); writeLibrary(games); const child = execFile(game.executable, args, { cwd: game.workingDirectory && fs.existsSync(game.workingDirectory) ? game.workingDirectory : path.dirname(game.executable), windowsHide: false }, error => { if (error) console.error('Lancement impossible:', error.message); }); child.once('spawn', () => { hideMainWindowToTray(); if (game.companionExecutable) execFile(game.companionExecutable, [], { cwd: path.dirname(game.companionExecutable), windowsHide: false }, error => { if (error) console.error('Application compagnon impossible à lancer:', error.message); }); activeSessions.set(id, Date.now()); const updated = readLibrary(), activeGame = updated.find(item => item.id === id); if (activeGame) { activeGame.sessionStartedAt = activeSessions.get(id); activeGame.launchCount = (Number(activeGame.launchCount) || 0) + 1; writeLibrary(updated); } }); child.once('close', () => { const wasTracked = activeSessions.has(id); finishPlaySession(id); if (wasTracked) restoreAfterGame(); }); return true; });
async function scanInstalledGames() {
  const candidates = [];
  const add = game => { if (game?.name && game.executable && fs.existsSync(game.executable)) candidates.push(game); };
  const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  // Steam : récupère aussi les bibliothèques ajoutées sur d'autres disques.
  const registryValue = (key, value) => { try { const output = execFileSync('reg.exe', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, timeout: 2500 }); return output.match(new RegExp('\\b' + value + '\\s+REG_\\w+\\s+(.+)', 'i'))?.[1]?.trim(); } catch { return null; } };
  const steamInstalls = [registryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'), registryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'), registryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')].filter(Boolean).map(value => value.replace(/\\/g, path.sep));
  const roots = new Set();
  for (const steamPath of steamInstalls) {
    roots.add(path.join(steamPath, 'steamapps', 'common'));
    const config = path.join(steamPath, 'config', 'libraryfolders.vdf');
    try { const text = fs.readFileSync(config, 'utf8'); for (const match of text.matchAll(/"path"\s+"((?:\\\\.|[^"])*)"/gi)) { const library = match[1].replace(/\\\\/g, '\\'); roots.add(path.join(library, 'steamapps', 'common')); } } catch {}
  }
  const skip = new Set(['_CommonRedist', 'Steamworks Shared', 'SteamVR']);
  for (const root of roots) {
    const steamApps = path.dirname(root), appIdsByInstallDir = new Map();
    try { for (const manifest of fs.readdirSync(steamApps).filter(name => /^appmanifest_\d+\.acf$/i.test(name))) { const text = fs.readFileSync(path.join(steamApps, manifest), 'utf8'); const appId = text.match(/"appid"\s+"(\d+)"/i)?.[1], installDir = text.match(/"installdir"\s+"([^"]+)"/i)?.[1]; if (appId && installDir) appIdsByInstallDir.set(installDir.toLowerCase(), appId); } } catch {}
    try { for (const folder of fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !skip.has(entry.name))) { const gameRoot = path.join(root, folder.name), stack = [{ dir: gameRoot, depth: 0 }], executables = []; while (stack.length) { const current = stack.pop(); if (current.depth > 5) continue; let entries; try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch { continue; } for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !/(unins|setup|crash|launcher|helper|benchmark|redist|easyanticheat|battleye)/i.test(entry.name)) executables.push(path.join(current.dir, entry.name)); else if (entry.isDirectory() && !entry.name.startsWith('.') && !/^(redist|support|directx|easyanticheat|battleye|__installer|engine|content)$/i.test(entry.name)) stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 }); }
      const folderName = normalizeTitle(folder.name), executable = executables.sort((a,b) => { const aa=normalizeTitle(path.basename(a,'.exe')),bb=normalizeTitle(path.basename(b,'.exe')); const score=x=>x===folderName?0:x.startsWith(folderName)||folderName.startsWith(x)?1:2; return score(aa)-score(bb); })[0];
      if (executable) add({ name: folder.name, executable, genre: 'À classer', source: 'Détection Steam', steamAppId: appIdsByInstallDir.get(folder.name.toLowerCase()) });
    } } catch { /* Bibliothèque Steam absente ou inaccessible. */ }
  }
  // Epic Games Launcher: les manifestes indiquent le dossier et l'exécutable du jeu.
  const epicManifests = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  try { for (const file of fs.readdirSync(epicManifests).filter(name => name.toLowerCase().endsWith('.item'))) { const manifest = readJson(path.join(epicManifests, file)); if (!manifest?.InstallLocation || !manifest?.LaunchExecutable) continue; const executable = path.resolve(manifest.InstallLocation, manifest.LaunchExecutable); add({ name: manifest.DisplayName || manifest.AppName, executable, args: typeof manifest.LaunchParameters === 'string' ? manifest.LaunchParameters.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(arg => arg.replace(/^"|"$/g, '')) || [] : [], workingDirectory: path.dirname(executable), genre: 'Epic Games', source: 'Epic Games' }); } } catch { /* Epic absent ou manifests inaccessibles. */ }
  // Ubisoft Connect : recherche Riders Republic dans les emplacements connus et ceux du registre.
  const ubisoftRoots = [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'games'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ubisoft', 'Ubisoft Game Launcher', 'games')];
  for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', 'HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs']) { try { const output=execFileSync('reg.exe',['query',key,'/s'],{encoding:'utf8',windowsHide:true,timeout:3500}); for(const line of output.split(/\r?\n/)){const match=line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);if(match){const value=match[1].trim().replace(/^"|"$/g,'');if(fs.existsSync(value)&&fs.statSync(value).isDirectory())ubisoftRoots.push(value)}} } catch {} }
  const visitedUbisoft = new Set(); const scanRiders = (dir,depth=0) => { if(depth>6||visitedUbisoft.has(dir.toLowerCase()))return;visitedUbisoft.add(dir.toLowerCase());let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return}for(const entry of entries){const full=path.join(dir,entry.name);if(entry.isFile()&&entry.name.toLowerCase().endsWith('.exe')&&/riders?[^\\/]*republic/i.test(entry.name)&&!/(launcher|unins|setup|crash|helper|easyanticheat|battleye)/i.test(entry.name)){add({name:'Riders Republic',executable:full,workingDirectory:path.dirname(full),genre:'Course',source:'Ubisoft Connect'});return}if(entry.isDirectory()&&!entry.name.startsWith('.')&&!/^(cache|logs|support|redist|easyanticheat|battleye|__installer)$/i.test(entry.name))scanRiders(full,depth+1)}};
  for(const root of ubisoftRoots)scanRiders(root);
  // GOG Galaxy: chaque goggame-*.info décrit une tâche de lancement; choisir la tâche primaire.
  const gogRoots = [process.env.ProgramData && path.join(process.env.ProgramData, 'GOG.com', 'Galaxy', 'storage'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'GOG.com', 'Galaxy', 'storage'), 'C:\\GOG Games', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GOG Galaxy', 'Games'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GOG Galaxy', 'Games')].filter(Boolean);
  const seenInfo = new Set();
  const scanGog = (dir, depth = 0) => { if (depth > 5) return; let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const entry of entries) { const full = path.join(dir, entry.name); if (entry.isFile() && /^goggame-.*\.info$/i.test(entry.name) && !seenInfo.has(full.toLowerCase())) { seenInfo.add(full.toLowerCase()); const info = readJson(full); const tasks = Array.isArray(info?.playTasks) ? info.playTasks : []; const task = tasks.find(item => item.isPrimary) || tasks[0]; if (!task?.path) continue; const installRoot = path.dirname(full); const executable = path.resolve(installRoot, task.path); const workingDirectory = task.workingDir ? path.resolve(installRoot, task.workingDir) : path.dirname(executable); add({ name: info.name || info.title || path.basename(installRoot), executable, args: Array.isArray(task.arguments) ? task.arguments : typeof task.arguments === 'string' && task.arguments ? task.arguments.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(arg => arg.replace(/^"|"$/g, '')) || [] : [], workingDirectory, genre: 'GOG', source: 'GOG Galaxy' }); } else if (entry.isDirectory() && !entry.name.startsWith('.') && !['cache', 'logs', 'webcache'].includes(entry.name.toLowerCase())) scanGog(full, depth + 1); } };
  for (const root of gogRoots) scanGog(root);
  const savedGames = readLibrary(); let appIdsUpdated = false;
  for (const candidate of candidates) { const saved = savedGames.find(game => game.executable.toLowerCase() === candidate.executable.toLowerCase()); if (saved && candidate.steamAppId && saved.steamAppId !== candidate.steamAppId) { saved.steamAppId = candidate.steamAppId; appIdsUpdated = true; } }
  if (appIdsUpdated) writeLibrary(savedGames);
  const known = new Set(savedGames.map(game => game.executable.toLowerCase()));
  return candidates.filter((game, index) => !known.has(game.executable.toLowerCase()) && candidates.findIndex(item => item.executable.toLowerCase() === game.executable.toLowerCase()) === index);
}
ipcMain.handle('games:scan', () => scanInstalledGames());
app.whenReady().then(() => { clearAbandonedSessions(); seedDefaultCollections(); writeLibrary(readLibrary()); startMediaKeyWorker(); createTray(); createWindow(); configureAutoUpdates(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('before-quit', () => { for (const gameId of [...activeSessions.keys()]) finishPlaySession(gameId); mediaSessionsStop?.(); if (mediaKeyWorker && !mediaKeyWorker.killed) mediaKeyWorker.stdin.end(); shutdownMediaSessions().catch(() => {}); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
