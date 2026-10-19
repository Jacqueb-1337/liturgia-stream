'use strict';

// Keep update handling in the main process. Only a deliberate Run Update
// action can close the app, and never while the RTMP encoder is active.
function createUpdateService({ updater, app, isStreaming, publish, platform = process.platform, appImage = process.env.APPIMAGE }) {
  const supported = !!app.isPackaged && (
    platform === 'win32' || platform === 'darwin' || (platform === 'linux' && !!appImage)
  );
  const state = {
    phase: 'idle', currentVersion: app.getVersion(), latestVersion: null,
    releaseNotes: '', percent: 0, error: '', supported
  };
  let checking = null;
  let downloading = null;
  const snapshot = () => ({ ...state });
  const update = (changes) => {
    Object.assign(state, changes);
    publish(snapshot());
    return snapshot();
  };
  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.setFeedURL({ provider: 'github', owner: 'Jacqueb-1337', repo: 'liturgia-stream' });
    updater.on('checking-for-update', () => update({ phase: 'checking', error: '' }));
    updater.on('update-available', (info) => update({
      phase: 'available', latestVersion: String(info.version || ''),
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes.slice(0, 6000)
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((entry) => entry.note || '').join('\n').slice(0, 6000)
          : '',
      percent: 0, error: ''
    }));
    updater.on('update-not-available', () => update({ phase: 'current', error: '' }));
    updater.on('download-progress', (progress) => update({
      phase: 'downloading', percent: Math.max(0, Math.min(100, Number(progress.percent) || 0))
    }));
    updater.on('update-downloaded', (info) => update({
      phase: 'downloaded', latestVersion: String(info.version || state.latestVersion || ''), percent: 100, error: ''
    }));
    updater.on('error', (error) => update({ phase: 'error', error: String(error?.message || error) }));
  }
  async function check() {
    if (!supported) return update({ phase: 'unsupported' });
    if (checking) return checking;
    if (downloading || state.phase === 'downloaded') return snapshot();
    checking = (async () => {
      try {
        update({ phase: 'checking', error: '' });
        await updater.checkForUpdates();
      } catch (error) {
        update({ phase: 'error', error: String(error?.message || error) });
      }
      return snapshot();
    })();
    try { return await checking; } finally { checking = null; }
  }
  async function download() {
    if (!supported || state.phase !== 'available') return { ok: false, error: 'No update is ready to download.' };
    if (downloading) return downloading;
    downloading = (async () => {
      try {
        update({ phase: 'downloading', percent: 0, error: '' });
        await updater.downloadUpdate();
        return { ok: true };
      } catch (error) {
        update({ phase: 'error', error: String(error?.message || error) });
        return { ok: false, error: state.error };
      }
    })();
    try { return await downloading; } finally { downloading = null; }
  }
  function install() {
    if (!supported || state.phase !== 'downloaded') return { ok: false, error: 'Download an update first.' };
    if (isStreaming()) return { ok: false, error: 'Disconnect the active stream before running the update.' };
    updater.quitAndInstall(false, true);
    return { ok: true };
  }
  return { snapshot, check, download, install };
}
module.exports = { createUpdateService };
