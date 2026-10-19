const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),load=p=>fs.readFileSync(path.join(root,p),'utf8');
describe('reusable Worship display profile workflow',()=>{
  const renderer=load('renderer.js'),main=load('main.js'),preload=load('preload.js');
  const editor=load('program-style-window.html'),index=load('index.html');
  test('add source can create or link an existing Worship profile',()=>{
    expect(index).toContain('id="program-display-picker"');
    expect(index).toContain('id="program-picker-select"');
    expect(index).toContain('id="program-picker-create"');
    expect(renderer).toContain('openProgramDisplayPicker');
    expect(renderer).toContain('worshipProfileId=profile.id');
    expect(renderer).toContain('layer.sourceStyles=structuredClone(profile.styles)');
    expect(renderer).toContain('Object.assign(layer,profile.layout||{})');
  });
  test('dedicated edit button uses Worship’s original safe area styling popover',()=>{
    expect(index).toContain('id="program-style-frame"');
    expect(renderer).toContain("control('fa-solid fa-pen-to-square', 'Edit Worship display styles and layout'");
    expect(editor).toContain('function initSafeAreaDrag()');
    expect(editor).toContain("document.getElementById('safe-area-box')");
    expect(editor).toContain("window.parent.postMessage({type:'liturgia-program-style-save'");
    expect(editor).not.toContain("require('electron')");
  });
  test('host-mediated updates are versioned and appear only on Preview until take',()=>{
    expect(main).toContain("'worship:profiles:update'");
    expect(main).toContain("'X-Liturgia-Stream-Token'");
    expect(renderer).toContain('expectedRevision:editingProgramRevision');
    expect(renderer).toContain('remote.revision === layer.worshipProfileRevision');
    expect(renderer).toContain('markSceneChanged();');
    expect(renderer).toContain('liveSceneSnapshot = cloneSceneForLive(currentScene())');
  });
  test('program source transforms save to shared Worship profile',()=>{
    expect(renderer).toContain('function syncProgramLayerLayout(layer)');
    expect(renderer).toContain('worshipProfileId');
    expect(renderer).toContain('programLayoutSaveQueue');
    expect(renderer).toContain('transparent');
    expect(renderer).toContain('programLayoutFromLayer');
  });
});
