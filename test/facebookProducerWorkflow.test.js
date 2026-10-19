const fs=require('fs');const path=require('path');
const src=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('Producer is opened exclusively through the user-invoked IPC handler',()=>{
  const main=src('main.js');
  expect(main).toMatch(/ipcMain\.handle\('stream:facebook:open'/);
  expect(main).not.toMatch(/destinations\.some\([^\n]*openFacebookProducer/);
  expect(main).not.toMatch(/facebookPromptedAt\.set\([\s\S]{0,65}openFacebookProducer\(/);
});
test('connection helper does not automatically publish and distinguishes publish from connect',()=>{
  const guide=src('facebookProducerGuide.js');
  const controller=src('facebookProducerController.js');
  expect(guide).toContain("mode === 'publish'");
  expect(guide).toContain("!el.hasAttribute('aria-current')");
  expect(guide).not.toMatch(/publish\.click\(/);
  expect(controller).toContain("if(activeMode==='connect'){popup.close();return;}");
  expect(controller).toContain('recordUrl(url)');
});
test('stream key recovery uses an explicitly selected key without accessing the clipboard',()=>{
  const main=src('main.js');
  const handler=main.slice(main.indexOf("ipcMain.handle('stream:facebook:use-key'"),main.indexOf("ipcMain.handle('stream:encoder:info'"));
  expect(handler).toContain('String(suppliedKey');
  expect(handler).not.toContain('clipboard.readText');
  expect(handler).toContain('settingsStore.saveDestination');
  expect(handler).toContain('outputManager.stop(id)');
});
