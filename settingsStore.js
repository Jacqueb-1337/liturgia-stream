'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  destination: null,
  output: { width: 1920, height: 1080, fps: 30, videoBitrateKbps: 6000, audioBitrateKbps: 160, audioSampleRate: 48000 },
  scenes: [
    { id: 'camera', name: 'Camera', cameraVisible: true, programVisible: false },
    { id: 'camera-program', name: 'Camera + Liturgia', cameraVisible: true, programVisible: true },
    { id: 'program', name: 'Liturgia Fullscreen', cameraVisible: false, programVisible: true }
  ],
  activeSceneId: 'camera-program'
};

function standardLayer(id, type, name, transparent = false) {
  return {
    id, type, name, x: 0, y: 0, width: 1920, height: 1080,
    cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
    panX: 0, panY: 0, zoom: 1, opacity: 1, brightness: 100,
    contrast: 100, saturation: 100, hue: 0, visible: true, locked: false,
    text: '', fontSize: 72, color: '#ffffff', imagePath: '', transparent, sourceStyles: {}
  };
}

function configuredScenes(stored) {
  const scenes = Array.isArray(stored.scenes) ? stored.scenes : DEFAULT_CONFIG.scenes;
  if (scenes.some(s => s.id === 'camera-program' && s.custom)) return scenes;
  const custom = scenes.find(s => s.custom && s.name === 'Custom Scene 1' &&
    s.layers?.some(layer => layer.type === 'camera') && s.layers?.some(layer => layer.type === 'program'));
  const cameraProgram = {
    id: 'camera-program', name: 'Camera + Liturgia', custom: true,
    cameraVisible: true, programVisible: true,
    layers: custom ? structuredClone(custom.layers).map((layer, index) => ({
      ...layer, id: 'builtin-cp-' + index
    })) : [
      standardLayer('builtin-cp-camera', 'camera', 'Camera'),
      standardLayer('builtin-cp-program', 'program', 'Liturgia Program', true)
    ]
  };
  return scenes.map(scene => scene.id === 'camera-program' ? cameraProgram : scene);
}

function createSettingsStore(userDataPath, safeStorage, fileSystem = fs) {
  const filePath = path.join(userDataPath, 'settings.json');
  const savedDestinations = (doc) => Array.isArray(doc.destinations) ? doc.destinations :
    (doc.destination ? [{ ...doc.destination, id: 'legacy-primary' }] : []);
  const publicDestination = (entry) => {
    let keySaved = false;
    if (typeof entry.encryptedKey === 'string' && safeStorage.isEncryptionAvailable()) {
      try { safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64')); keySaved = true; } catch (_) {}
    }
    return { id: entry.id, name: String(entry.name || ''), server: String(entry.server || ''), keySaved };
  };

  async function readRaw() {
    try {
      const text = await fileSystem.promises.readFile(filePath, 'utf8');
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async function writeRaw(document) {
    await fileSystem.promises.mkdir(userDataPath, { recursive: true });
    const temporaryPath = filePath + '.tmp';
    await fileSystem.promises.writeFile(temporaryPath, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fileSystem.promises.rename(temporaryPath, filePath);
  }

  return {
    async load() {
      const stored = await readRaw();
      let destination = null;
      if (stored.destination && typeof stored.destination === 'object') {
        const { name, server, encryptedKey } = stored.destination;
        let keySaved = false;
        if (typeof encryptedKey === 'string' && safeStorage.isEncryptionAvailable()) {
          try {
            safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'));
            keySaved = true;
          } catch (_) {}
        }
        destination = { name: String(name || ''), server: String(server || ''), keySaved };
      }
      return {
        destination,
        destinations: savedDestinations(stored).map(publicDestination),
        output: { ...DEFAULT_CONFIG.output, ...(stored.output || {}) },
        devices: { cameraId: String(stored.devices?.cameraId || ''), microphoneId: String(stored.devices?.microphoneId || '') },
        scenes: configuredScenes(stored),
        activeSceneId: stored.activeSceneId || DEFAULT_CONFIG.activeSceneId
      };
    },

    async save(config) {
      const name = String(config?.destination?.name || '').trim();
      const server = String(config?.destination?.server || '').trim();
      const streamKey = String(config?.destination?.streamKey || '');
      if (!name) throw new Error('Enter a destination name.');
      if (!/^rtmps?:\/\//i.test(server)) throw new Error('Enter an RTMP or RTMPS server address.');
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows secure storage is not available, so Liturgia Stream cannot save the stream key safely.');
      }

      const previous = await readRaw();
      const existingEncryptedKey = previous.destination && previous.destination.encryptedKey;
      let existingKeyAvailable = false;
      if (typeof existingEncryptedKey === 'string') {
        try {
          safeStorage.decryptString(Buffer.from(existingEncryptedKey, 'base64'));
          existingKeyAvailable = true;
        } catch (_) {}
      }
      if (!streamKey.trim() && !existingKeyAvailable) throw new Error('Enter a stream key.');
      const output = { ...DEFAULT_CONFIG.output, ...(config.output || {}) };
      const encryptedKey = streamKey.trim()
        ? safeStorage.encryptString(streamKey).toString('base64')
        : existingEncryptedKey;
      const document = {
        ...previous,
        destination: { name, server, encryptedKey },
        output
      };
      await writeRaw(document);
      return { destination: { name, server, keySaved: true }, output };
    },

    async saveDestination(item) {
      const name = String(item?.name || '').trim().slice(0, 80);
      const server = String(item?.server || '').trim();
      const freshKey = String(item?.streamKey || '').trim();
      const id = typeof item?.id === 'string' && /^[a-zA-Z0-9_-]{4,90}$/.test(item.id)
        ? item.id : require('crypto').randomUUID();
      if (!name) throw new Error('Enter a destination name.');
      if (!/^rtmps?:\/\//i.test(server)) throw new Error('Enter a valid RTMP or RTMPS server.');
      // Parse URLs early to avoid saving malformed destinations.
      const u = new URL(server);
      if (!['rtmp:', 'rtmps:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash) {
        throw new Error('Use a server URL without credentials or query parameters.');
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is not available on this device.');
      const previous = await readRaw();
      const destinations = savedDestinations(previous);
      const existing = destinations.find((d) => d.id === id);
      if (!existing && destinations.length >= 12) throw new Error('At most 12 stream destinations can be saved.');
      const encryptedKey = freshKey ? safeStorage.encryptString(freshKey).toString('base64') : existing?.encryptedKey;
      if (!encryptedKey) throw new Error('Enter a stream key.');
      if (!freshKey) {
        try { safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')); }
        catch (_) { throw new Error('The saved stream key is unavailable. Enter a new one.'); }
      }
      const updated = { id, name, server, encryptedKey };
      const next = existing ? destinations.map((d) => d.id === id ? updated : d) : [...destinations, updated];
      await writeRaw({ ...previous, destinations: next });
      return publicDestination(updated);
    },

    async deleteDestination(id) {
      const previous = await readRaw();
      const next = savedDestinations(previous).filter((d) => d.id !== id);
      await writeRaw({ ...previous, destinations: next });
      return next.map(publicDestination);
    },

    async saveOutput(output) {
      const previous = await readRaw();
      const next = { ...DEFAULT_CONFIG.output, ...(output || {}) };
      await writeRaw({ ...previous, output: next });
      return next;
    },

    async getDestinationCredentialsByIds(ids) {
      const previous = await readRaw();
      const destinations = savedDestinations(previous);
      const selected = Array.isArray(ids) && ids.length ? destinations.filter((d) => ids.includes(d.id)) : destinations;
      if (!selected.length) throw new Error('Add a destination in Stream Setup first.');
      if (Array.isArray(ids) && ids.length && selected.length !== new Set(ids).size) throw new Error('A destination was not found.');
      return selected.map((entry) => {
        if (!entry.encryptedKey) throw new Error('A destination has no saved stream key.');
        let streamKey;
        try { streamKey = safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64')); }
        catch (_) { throw new Error('A saved stream key is unavailable. Edit the destination.'); }
        return { id: entry.id, name: entry.name, server: entry.server, streamKey };
      });
    },

    async getDestinationCredentials() {
      const stored = await readRaw();
      const destination = stored.destination || {};
      if (typeof destination.encryptedKey !== 'string' || !safeStorage.isEncryptionAvailable()) {
        throw new Error('Save a destination and stream key before going live.');
      }
      let streamKey;
      try {
        streamKey = safeStorage.decryptString(Buffer.from(destination.encryptedKey, 'base64'));
      } catch (_) {
        throw new Error('The saved stream key cannot be opened. Enter it again in Stream Setup.');
      }
      return {
        name: String(destination.name || ''),
        server: String(destination.server || ''),
        streamKey
      };
    },

    async saveDevices(devices) {
      const previous = await readRaw();
      const selected = {
        cameraId: String(devices?.cameraId || '').slice(0, 512),
        microphoneId: String(devices?.microphoneId || '').slice(0, 512)
      };
      await writeRaw({ ...previous, devices: selected });
      return selected;
    },

    async saveScenes(scenes, activeSceneId) {
      if (!Array.isArray(scenes) || !scenes.length) throw new Error('At least one scene is required.');
      const bounded = (value, fallback, min, max) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
      };
      const normalized = scenes.slice(0, 20).map((scene, index) => {
        const common = {
          id: String(scene.id || `scene-${index + 1}`).slice(0, 64),
          name: String(scene.name || `Scene ${index + 1}`).trim().slice(0, 48),
          cameraVisible: scene.cameraVisible === true,
          programVisible: scene.programVisible === true
        };
        if (scene.custom !== true) return common;
        return {
          ...common,
          custom: true,
          layers: (Array.isArray(scene.layers) ? scene.layers : []).slice(0, 20)
            .filter((layer) => ['program', 'widgets', 'camera', 'image', 'text'].includes(layer?.type))
            .map((layer, layerIndex) => ({
              id: String(layer.id || `layer-${layerIndex + 1}`).slice(0, 64),
              type: layer.type,
              name: String(layer.name || layer.type).slice(0, 48),
              x: bounded(layer.x, 0, -1920, 3840),
              y: bounded(layer.y, 0, -1080, 2160),
              width: bounded(layer.width, 960, 20, 3840),
              height: bounded(layer.height, 540, 20, 2160),
              cropLeft: bounded(layer.cropLeft, 0, 0, .95),
              cropTop: bounded(layer.cropTop, 0, 0, .95),
              cropRight: bounded(layer.cropRight, 0, 0, .95),
              cropBottom: bounded(layer.cropBottom, 0, 0, .95),
              panX: bounded(layer.panX, 0, -100, 100),
              panY: bounded(layer.panY, 0, -100, 100),
              zoom: bounded(layer.zoom, 1, 1, 5),
              opacity: bounded(layer.opacity, 1, 0, 1),
              brightness: bounded(layer.brightness, 100, 0, 200),
              contrast: bounded(layer.contrast, 100, 0, 200),
              saturation: bounded(layer.saturation, 100, 0, 200),
              hue: bounded(layer.hue, 0, -180, 180),
              visible: layer.visible !== false,
              locked: layer.locked === true,
              text: String(layer.text || '').slice(0, 2000),
              fontSize: bounded(layer.fontSize, 72, 8, 300),
              color: /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : '#ffffff',
              imagePath: typeof layer.imagePath === 'string' ? layer.imagePath.slice(0, 2048) : '',
              transparent: layer.transparent === true,
              offlineMode: layer.type === 'program' && ['none','preserve','placeholder'].includes(layer.offlineMode)
                ? layer.offlineMode : 'none',
              offlineText: layer.type === 'program' ? String(layer.offlineText || '').slice(0,500) : '',
              worshipProfileId: layer.type === 'program' && /^[a-z0-9-]{8,80}$/i.test(layer.worshipProfileId || '')
                ? layer.worshipProfileId : '',
              worshipProfileRevision: layer.type === 'program'
                ? bounded(layer.worshipProfileRevision, 0, 0, Number.MAX_SAFE_INTEGER) : 0,
              sourceStyles: Object.fromEntries(
                Object.entries(layer.sourceStyles || {})
                  .filter(([key, css]) => ['verseText', 'verseNumber', 'verseSubscript', 'verseReference',
                    'songText', 'songTitle', 'songReference', 'global'].includes(key) && typeof css === 'string')
                  .map(([key, css]) => [key, css.slice(0, 8192)])
              )
            }))
        };
      });
      if (normalized.some((scene) => !scene.name)) throw new Error('Scene names cannot be blank.');
      const selected = normalized.some((scene) => scene.id === activeSceneId) ? activeSceneId : normalized[0].id;
      const previous = await readRaw();
      await writeRaw({ ...previous, scenes: normalized, activeSceneId: selected });
      return { scenes: normalized, activeSceneId: selected };
    }
  };
}

module.exports = { createSettingsStore, DEFAULT_CONFIG };
