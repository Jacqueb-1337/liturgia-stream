const { app, BrowserWindow, ipcMain, session, safeStorage, dialog } = require('electron');
const { createSettingsStore } = require('./settingsStore');
const { executableCandidates, probeFirstAvailable, buildRtmpUrl } = require('./ffmpegRuntime');
const { MultiOutputManager } = require('./multiOutputManager');
const { openFacebookProducer, updateFacebookProducer, getActiveSourceId, hasValidProducerSession } = require('./facebookProducerController');
const { createUpdateService } = require('./updateService');
const { autoUpdater } = require('electron-updater');

const { Bonjour } = require('bonjour-service');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let bonjour = null;
let browser = null;
const discovered = new Map();
const publicInstances = () => [...discovered.values()].map(({ styleToken, ...instance }) => instance);
let settingsStore = null;
let encoderProbe = null;
let outputManager = null;
let updateService = null;
let quitAfterOutputStopped = false;
const targetServerById = new Map();
const facebookPromptedAt = new Map();

function getEncoderInfo() {
  if (!encoderProbe) {
    encoderProbe = probeFirstAvailable(executableCandidates({
      platform: process.platform,
      configuredPath: process.env.LITURGIA_FFMPEG_PATH,
      resourcesPath: process.resourcesPath,
      appPath: __dirname
    }));
  }
  return encoderProbe;
}

function publishDiscovery() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('worship:instances', publicInstances());
  }
}

function normalizeService(service) {
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  const address = addresses.find((item) => net.isIPv4(item) && !item.startsWith('169.254.'))
    || service.host;
  if (!address || !Number.isInteger(service.port)) return null;

  const displayId = String((service.txt && service.txt.displayId) ?? '');
  const key = `${service.name}|${displayId}|${service.port}`;
  return {
    key,
    name: service.name || 'Liturgia Worship',
    displayId,
    address,
    port: service.port,
    version: String((service.txt && service.txt.version) || ''),
    url: `http://${address}:${service.port}/`,
    programStreamUrl: displayId === '0' ? `ws://${address}:${service.port}/program-stream` : null,
    styleAvailable: displayId === '0' && !!service.txt?.styleToken,
    styleToken: displayId === '0' ? String(service.txt?.styleToken || '') : ''
  };
}

function requestWorshipStyles(key, method, styles) {
  const instance = discovered.get(key);
  if (!instance?.styleToken || instance.displayId !== '0') {
    return Promise.reject(new Error('This Worship instance does not support LAN style editing.'));
  }
  const body = styles ? JSON.stringify(styles) : '';
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: instance.address,
      port: instance.port,
      path: '/program-styles',
      method,
      timeout: 5000,
      headers: {
        'X-Liturgia-Stream-Token': instance.styleToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let result = '';
      response.on('data', (chunk) => {
        result += chunk;
        if (result.length > 32768) response.destroy(new Error('Worship style response is too large.'));
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(result);
          if (response.statusCode !== 200) throw new Error(parsed.error || 'Could not edit Worship styles.');
          resolve(parsed.styles);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Worship did not respond.')));
    request.on('error', reject);
    request.end(body);
  });
}

function requestWorshipDisplayProfiles(key,method='GET',id=null,body=null) {
  const instance=discovered.get(key);
  if(!instance?.styleToken||instance.displayId!=='0') {
    return Promise.reject(new Error('Connect the primary Liturgia Worship Program instance to edit display profiles.'));
  }
  const encoded=id?'/'+encodeURIComponent(id):'';
  const payload=body?JSON.stringify(body):'';
  return new Promise((resolve,reject)=>{
    const request=http.request({
      hostname:instance.address,port:instance.port,
      path:'/program-displays'+encoded,method,timeout:6000,
      headers:{'X-Liturgia-Stream-Token':instance.styleToken,
        'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}
    },response=>{
      let result='';
      response.on('data',chunk=>{
        result+=chunk;
        if(result.length>4*1024*1024)response.destroy(new Error('Display profile response was too large.'));
      });
      response.on('end',()=>{
        try{
          const parsed=JSON.parse(result);
          if(response.statusCode!==200){
            const error=new Error(parsed.error||'Could not synchronize Program displays.');
            error.status=response.statusCode;throw error;
          }
          resolve(parsed.displays||[]);
        }catch(error){reject(error)}
      });
      response.on('error',reject);
    });
    request.on('timeout',()=>request.destroy(new Error('Liturgia Worship did not respond.')));
    request.on('error',reject);
    request.end(payload);
  });
}

function startDiscovery() {
  if (browser) browser.stop();
  if (bonjour) bonjour.destroy();
  discovered.clear();
  bonjour = new Bonjour((error) => console.warn('[discovery] mDNS error:', error.message));
  browser = bonjour.find({ type: 'liturgia-display', protocol: 'tcp' });
  browser.on('up', (service) => {
    const item = normalizeService(service);
    if (!item) return;
    discovered.set(item.key, item);
    publishDiscovery();
  });
  browser.on('down', (service) => {
    const item = normalizeService(service);
    if (item) discovered.delete(item.key);
    else {
      for (const [key, known] of discovered) {
        if (known.name === service.name) discovered.delete(key);
      }
    }
    publishDiscovery();
  });
  browser.start();
  publishDiscovery();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#181a1b',
    title: 'Liturgia Stream',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  settingsStore = createSettingsStore(app.getPath('userData'), safeStorage);
  outputManager = new MultiOutputManager();
  updateService = createUpdateService({
    updater: autoUpdater,
    app,
    // Fail closed on unknown/starting/stopping stream states.
    isStreaming: () => !outputManager || !['idle', 'stopped'].includes(outputManager.state),
    publish: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream:update:status', state);
    }
  });
  ipcMain.handle('stream:update:get', () => updateService.snapshot());
  ipcMain.handle('stream:update:check', () => updateService.check());
  ipcMain.handle('stream:update:download', () => updateService.download());
  ipcMain.handle('stream:update:run', () => updateService.install());
  ipcMain.handle('stream:update:release', () => require('electron').shell.openExternal('https://github.com/Jacqueb-1337/liturgia-stream/releases/latest'));
  outputManager.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream:output:status', status);
    updateFacebookProducer(status);
    if (status.state === 'reconnecting' && status.sourceId &&
        /facebook\.com/i.test(targetServerById.get(status.sourceId) || '') &&
        /error opening output|io error|end of file|closed|rejected|failed/i.test(status.error || '')) {
      const last = facebookPromptedAt.get(status.sourceId) || 0;
      if (Date.now() - last > 10 * 60 * 1000) {
        facebookPromptedAt.set(status.sourceId, Date.now());
        // Never open Producer automatically; the renderer displays a user-activated link.
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream:facebook:help', status.sourceId);
      }
    }
  });
  ipcMain.handle('stream:config:get', () => settingsStore.load());
  ipcMain.handle('stream:output:start', async (_event, ids = null) => {
    const [destinations, config, runtime] = await Promise.all([
      settingsStore.getDestinationCredentialsByIds(ids),
      settingsStore.load(),
      getEncoderInfo()
    ]);
    const mapped = destinations.map(({ id, name, server, streamKey }) => {
      targetServerById.set(id, server);
      return { id, name, outputUrl: buildRtmpUrl(server, streamKey) };
    });
    const starting = outputManager.start({ runtime, output: config.output, destinations: mapped });
    return starting;
  });
  ipcMain.handle('stream:output:chunk', (_event, data) => outputManager.writeChunk(data));
  ipcMain.handle('stream:output:stop', (_event, id = null) => outputManager.stop(id));
  ipcMain.handle('stream:output:status:get', () => outputManager.snapshot());
  ipcMain.handle('stream:destination:save', (_event, item) => settingsStore.saveDestination(item));
  ipcMain.handle('stream:destination:delete', async (_event, id) => {
    await outputManager.stop(id);
    return settingsStore.deleteDestination(id);
  });
  ipcMain.handle('stream:quality:save', (_event, output) => settingsStore.saveOutput(output));
  ipcMain.handle('stream:facebook:session', (_event, sourceId) => ({ valid: hasValidProducerSession(sourceId) }));
  ipcMain.handle('stream:facebook:open', (_event, mode = 'connect', sourceId = null) => {
    openFacebookProducer(mainWindow, { mode, sourceId });
    return true;
  });
  ipcMain.handle('stream:facebook:use-clipboard-key', async () => {
    const { dialog } = require('electron');
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Cancel', 'Use copied key'], defaultId: 0, cancelId: 0,
      title: 'Update Facebook stream key',
      message: 'Replace the saved Facebook stream key with the current clipboard text?',
      detail: 'Only continue after explicitly copying the key in Facebook Producer. Liturgia will encrypt the key and retry this destination.'
    });
    if (choice.response !== 1) throw new Error('Stream key import cancelled.');
    const id = getActiveSourceId();
    if (!id) throw new Error('No Facebook destination is selected.');
    const { clipboard } = require('electron');
    const key = clipboard.readText().trim();
    if (key.length < 12 || key.length > 1024 || /\s/.test(key) || /^https?:/i.test(key))
      throw new Error('Copy the stream key from Facebook Producer before selecting this button.');
    const config = await settingsStore.load();
    const dest = config.destinations.find(d => d.id === id);
    if (!dest) throw new Error('Facebook destination is unavailable.');
    await settingsStore.saveDestination({ id, name: dest.name, server: dest.server, streamKey: key });
    await outputManager.stop(id);
    const credentials = await settingsStore.getDestinationCredentialsByIds([id]);
    const runtime = await getEncoderInfo();
    const mapped = credentials.map(d => ({id:d.id,name:d.name,outputUrl:buildRtmpUrl(d.server,d.streamKey)}));
    return outputManager.start({runtime,output:config.output,destinations:mapped});
  });
  ipcMain.handle('stream:encoder:info', async () => {
    const info = await getEncoderInfo();
    return {
      available: info.available,
      encoder: info.encoder ? info.encoder.label : null,
      supported: info.supported.map((item) => item.label),
      error: info.error
    };
  });
  ipcMain.handle('stream:config:save', (_event, config) => settingsStore.save(config));
  ipcMain.handle('stream:scenes:save', (_event, scenes, activeSceneId) => settingsStore.saveScenes(scenes, activeSceneId));
  ipcMain.handle('stream:devices:save', (_event, devices) => settingsStore.saveDevices(devices));
  ipcMain.handle('stream:offline-frame:save', async (_event, id, dataUrl) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{4,90}$/.test(id)) throw new Error('Invalid layer ID.');
    if (typeof dataUrl !== 'string' || !/^data:image\/webp;base64,/.test(dataUrl) || dataUrl.length > 9*1024*1024) throw new Error('Invalid offline frame.');
    const directory=path.join(app.getPath('userData'),'offline-program-frames');
    await fs.promises.mkdir(directory,{recursive:true});
    const bytes=Buffer.from(dataUrl.slice(dataUrl.indexOf(',')+1),'base64');
    if(bytes.length>6*1024*1024)throw new Error('Offline frame is too large.');
    await fs.promises.writeFile(path.join(directory,id+'.webp'),bytes);
    return true;
  });
  ipcMain.handle('stream:offline-frame:load', async (_event,id) => {
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{4,90}$/.test(id))return null;
    try {
      const bytes=await fs.promises.readFile(path.join(app.getPath('userData'),'offline-program-frames',id+'.webp'));
      return bytes.length<=6*1024*1024?'data:image/webp;base64,'+bytes.toString('base64'):null;
    } catch(error){if(error.code==='ENOENT')return null;throw error}
  });
  ipcMain.handle('stream:image:choose', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle('stream:image:read', async (_event, imagePath) => {
    if (typeof imagePath !== 'string' || !/\.(png|jpe?g|webp|gif)$/i.test(imagePath)) throw new Error('Choose a supported image.');
    const stat = await fs.promises.stat(imagePath);
    if (stat.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
    const mime = /\.png$/i.test(imagePath) ? 'image/png' : /\.webp$/i.test(imagePath) ? 'image/webp' : /\.gif$/i.test(imagePath) ? 'image/gif' : 'image/jpeg';
    return `data:${mime};base64,${(await fs.promises.readFile(imagePath)).toString('base64')}`;
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
  ipcMain.handle('worship:discover', () => {
    startDiscovery();
    return publicInstances();
  });
  ipcMain.handle('worship:refresh', () => {
    if (browser) browser.update();
    return publicInstances();
  });
  ipcMain.handle('worship:instances', () => publicInstances());
  ipcMain.handle('worship:profiles:list', (_event, key) => requestWorshipDisplayProfiles(key));
  ipcMain.handle('worship:profiles:create', (_event, key, data) => requestWorshipDisplayProfiles(key,'POST',null,data));
  ipcMain.handle('worship:profiles:update', (_event, key, id, data) => requestWorshipDisplayProfiles(key,'PUT',id,data));
  ipcMain.handle('worship:profiles:delete', (_event, key, id) => requestWorshipDisplayProfiles(key,'DELETE',id));
  ipcMain.handle('worship:styles:get', (_event, key) => requestWorshipStyles(key, 'GET'));
  ipcMain.handle('worship:styles:save', (_event, key, styles) => requestWorshipStyles(key, 'PUT', styles));
  createWindow();
  // Check quietly after the first window renders, and every six hours thereafter.
  mainWindow.webContents.once('did-finish-load', () => {
    const firstCheck = setTimeout(() => { void updateService.check(); }, 5000);
    firstCheck.unref?.();
  });
  const updateInterval = setInterval(() => { void updateService.check(); }, 6 * 60 * 60 * 1000);
  updateInterval.unref?.();
  startDiscovery();
});

app.on('before-quit', (event) => {
  if (!quitAfterOutputStopped && outputManager && !['idle', 'stopped'].includes(outputManager.state)) {
    event.preventDefault();
    void outputManager.stop().finally(() => {
      quitAfterOutputStopped = true;
      app.quit();
    });
    return;
  }
  if (browser) browser.stop();
  if (bonjour) bonjour.destroy();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
