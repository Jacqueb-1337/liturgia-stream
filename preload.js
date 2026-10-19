const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liturgiaStream', {
  discoverWorship: () => ipcRenderer.invoke('worship:discover'),
  refreshWorship: () => ipcRenderer.invoke('worship:refresh'),
  getWorshipInstances: () => ipcRenderer.invoke('worship:instances'),
  getProgramDisplayProfiles: (key) => ipcRenderer.invoke('worship:profiles:list', key),
  createProgramDisplayProfile: (key, data) => ipcRenderer.invoke('worship:profiles:create', key, data),
  updateProgramDisplayProfile: (key, id, data) => ipcRenderer.invoke('worship:profiles:update', key, id, data),
  deleteProgramDisplayProfile: (key, id) => ipcRenderer.invoke('worship:profiles:delete', key, id),
  getWorshipStyles: (key) => ipcRenderer.invoke('worship:styles:get', key),
  saveWorshipStyles: (key, styles) => ipcRenderer.invoke('worship:styles:save', key, styles),
  getConfig: () => ipcRenderer.invoke('stream:config:get'),
  getUpdateStatus: () => ipcRenderer.invoke('stream:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('stream:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('stream:update:download'),
  runUpdate: () => ipcRenderer.invoke('stream:update:run'),
  openReleasePage: () => ipcRenderer.invoke('stream:update:release'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('stream:update:status', listener);
    return () => ipcRenderer.removeListener('stream:update:status', listener);
  },
  getEncoderInfo: () => ipcRenderer.invoke('stream:encoder:info'),
  saveConfig: (config) => ipcRenderer.invoke('stream:config:save', config),
  startOutput: (ids) => ipcRenderer.invoke('stream:output:start', ids),
  getOutputStatus: () => ipcRenderer.invoke('stream:output:status:get'),
  saveDestination: (item) => ipcRenderer.invoke('stream:destination:save', item),
  deleteDestination: (id) => ipcRenderer.invoke('stream:destination:delete', id),
  saveQuality: (output) => ipcRenderer.invoke('stream:quality:save', output),
  openFacebookProducer: (mode, sourceId) => ipcRenderer.invoke('stream:facebook:open', mode, sourceId),
  getFacebookProducerSession: (sourceId) => ipcRenderer.invoke('stream:facebook:session', sourceId),
  sendOutputChunk: (data) => ipcRenderer.invoke('stream:output:chunk', data),
  logDiagnostic: (category, details) => ipcRenderer.invoke('stream:diagnostic', category, details),
  onDiagnostic: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('stream:diagnostics', listener);
    return () => ipcRenderer.removeListener('stream:diagnostics', listener);
  },
  stopOutput: (id) => ipcRenderer.invoke('stream:output:stop', id),
  onFacebookHelp: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('stream:facebook:help', listener);
    return () => ipcRenderer.removeListener('stream:facebook:help', listener);
  },
  onOutputStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('stream:output:status', listener);
    return () => ipcRenderer.removeListener('stream:output:status', listener);
  },
  saveScenes: (scenes, activeSceneId) => ipcRenderer.invoke('stream:scenes:save', scenes, activeSceneId),
  saveOfflineProgramFrame: (id, data) => ipcRenderer.invoke('stream:offline-frame:save',id,data),
  loadOfflineProgramFrame: (id) => ipcRenderer.invoke('stream:offline-frame:load',id),
  chooseLayerImage: () => ipcRenderer.invoke('stream:image:choose'),
  readLayerImage: (path) => ipcRenderer.invoke('stream:image:read', path),
  saveDevices: (devices) => ipcRenderer.invoke('stream:devices:save', devices),
  onWorshipInstances: (callback) => {
    const listener = (_event, instances) => callback(instances);
    ipcRenderer.on('worship:instances', listener);
    return () => ipcRenderer.removeListener('worship:instances', listener);
  }
});
