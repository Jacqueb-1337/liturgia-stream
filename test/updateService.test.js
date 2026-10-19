const { EventEmitter } = require('events');
const { createUpdateService } = require('../updateService');

function setup({ packaged = true, platform = 'win32' } = {}) {
  const updater = new EventEmitter();
  updater.setFeedURL = jest.fn();
  updater.checkForUpdates = jest.fn(async () => {
    updater.emit('update-available', { version: '0.1.2', releaseNotes: 'Streaming stability' });
  });
  updater.downloadUpdate = jest.fn(async () => {
    updater.emit('download-progress', { percent: 53 });
    updater.emit('update-downloaded', { version: '0.1.2' });
  });
  updater.quitAndInstall = jest.fn();
  const output = { streaming: false };
  const statuses = [];
  const service = createUpdateService({
    updater,
    app: { isPackaged: packaged, getVersion: () => '0.1.1' },
    isStreaming: () => output.streaming,
    publish: (status) => statuses.push(status),
    platform
  });
  return { updater, service, output, statuses };
}

test('does not enable updater outside packaged installs', async () => {
  const { service, updater } = setup({ packaged: false });
  expect((await service.check()).phase).toBe('unsupported');
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  expect(updater.setFeedURL).not.toHaveBeenCalled();
});

test('checks GitHub without downloading until the user requests it', async () => {
  const { service, updater } = setup();
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'github', repo: 'liturgia-stream'
  }));
  expect((await service.check()).phase).toBe('available');
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
  await service.download();
  expect(service.snapshot()).toMatchObject({ phase: 'downloaded', percent: 100, latestVersion: '0.1.2' });
});

test('prevents running a downloaded update during active streaming', async () => {
  const { service, updater, output } = setup();
  await service.check();
  await service.download();
  output.streaming = true;
  expect(service.install()).toMatchObject({ ok: false });
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  output.streaming = false;
  expect(service.install()).toMatchObject({ ok: true });
  expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
});

test('a failed update check reports an error instead of crashing', async () => {
  const { service, updater } = setup();
  updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
  expect((await service.check()).phase).toBe('error');
  expect(service.snapshot().error).toContain('offline');
});
