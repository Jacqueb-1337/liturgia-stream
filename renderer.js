const actionConfirmDialog = document.getElementById('action-confirm');
const actionConfirmMessage = document.getElementById('action-confirm-message');
const actionConfirmAccept = document.getElementById('action-confirm-accept');

function confirmAction(message, acceptLabel) {
  if (actionConfirmDialog.open) return Promise.resolve(false);
  const previousFocus = document.activeElement;
  actionConfirmMessage.textContent = message;
  actionConfirmAccept.textContent = acceptLabel;
  actionConfirmDialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    actionConfirmDialog.addEventListener('close', () => {
      resolve(actionConfirmDialog.returnValue === 'confirm');
      if (previousFocus?.isConnected) previousFocus.focus();
    }, { once: true });
    actionConfirmDialog.showModal();
  });
}

const tabs = [...document.querySelectorAll('.tab')];
const pages = [...document.querySelectorAll('.page')];
const instanceList = document.getElementById('instance-list');
const worshipStatus = document.getElementById('worship-status');
const headerStatus = document.querySelector('.header-status');
const preview = document.getElementById('program-preview');
const previewContext = preview.getContext('2d');
let programSocket = null;
let selectedInstanceKey = '';
let programFrame = null;
let pendingProgramFrame = null;
let decodingProgramFrame = false;
const previewEmpty = document.getElementById('preview-empty');
const previewState = document.getElementById('preview-state');
const sceneCameraPreview = document.getElementById('scene-camera-preview');
const sceneList = document.getElementById('scene-list');
const sceneMessage = document.getElementById('scene-message');
const customEditor = document.getElementById('custom-scene-editor');
const editorCanvas = document.getElementById('scene-editor-preview');
const editorContext = editorCanvas.getContext('2d');
const editorInteraction = document.getElementById('editor-interaction');
const editorSelection = document.getElementById('editor-selection');
const layerList = document.getElementById('layer-list');
const layerProperties = document.getElementById('layer-properties');
const imageCache = new Map();
const programReceivers = new Map();
const programReceiverHost = document.getElementById('program-receivers');
let selectedLayerId = '';
let sceneSaveQueue = Promise.resolve();
const instancesByKey = new Map();
const worshipStyleEditor = document.getElementById('worship-style-editor');
let worshipStyles = null;
let worshipStyleInstanceKey = '';
let worshipStyleSaveTimer = null;
let scenes = [];
let activeSceneId = 'camera-program';
let liveSceneSnapshot = null;
let liveProgramCanvas = null;
let liveProgramContext = null;
let sceneChangesPending = false;
let thumbnailLastDraw = 0;
const sceneThumbnailCanvases = new Map();
function cloneSceneForLive(scene) {
  const clone = structuredClone(scene);
  if (clone?.custom) clone.layers = clone.layers.map(layer => ({ ...layer, id: 'live-' + layer.id }));
  return clone;
}
function markSceneChanged() {
  if (outputActive && liveSceneSnapshot) {
    sceneChangesPending = true;
    const apply = document.getElementById('apply-scene-live');
    if (apply) apply.hidden = false;
  }
}
function applySceneChangesLive() {
  liveSceneSnapshot = cloneSceneForLive(currentScene());
  sceneChangesPending = false;
  document.getElementById('apply-scene-live').hidden = true;
  updateProgramReceivers();
}

let selectedDevices = { cameraId: '', microphoneId: '' };
async function saveDeviceSelections() {
  try {
    selectedDevices = await window.liturgiaStream.saveDevices(selectedDevices);
  } catch (error) {
    const message = document.getElementById('video-message');
    if (message) message.textContent = `Could not save device selection: ${error.message}`;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    pages.forEach((page) => page.classList.toggle('active', page.id === `page-${tab.dataset.page}`));
  });
}

function currentScene() {
  return scenes.find((scene) => scene.id === activeSceneId) || scenes[0] || null;
}

function sceneHasSource(scene, type) {
  return scene?.custom ? scene.layers.some((layer) => layer.type === type && layer.visible) :
    type === 'program' ? !!scene?.programVisible : type === 'camera' ? !!scene?.cameraVisible : false;
}

function sendProgramSourceStyles(layer) {
  if(layer.type==='widgets')return;
  const receiver = programReceivers.get(layer.id);
  if (receiver?.ready) receiver.iframe.contentWindow.postMessage({
    type: 'liturgia-stream-styles', layerId: layer.id, styles: layer.sourceStyles || {}
  }, receiver.origin);
}

function updateProgramReceivers() {
  const scene = currentScene();
  const instance = instancesByKey.get(selectedInstanceKey);
  const requested = instance?.url ? [scene, liveSceneSnapshot]
    .filter(item => item?.custom)
    .flatMap(item => item.layers.filter(layer => ['program','widgets'].includes(layer.type) && layer.visible)) : [];
  const keep = new Set(requested.map((layer) => layer.id));
  for (const [id, receiver] of programReceivers) {
    const layer = requested.find((item) => item.id === id);
    if (keep.has(id) && receiver.key === selectedInstanceKey && receiver.transparent === !!layer.transparent) continue;
    receiver.frame?.close();
    receiver.iframe.remove();
    programReceivers.delete(id);
  }
  if (!instance) return;
  const origin = new URL(instance.url).origin;
  for (const layer of requested) {
    if (programReceivers.has(layer.id)) {
      sendProgramSourceStyles(layer);
      continue;
    }
    const iframe = document.createElement('iframe');
    iframe.title = `Worship source ${layer.name}`;
    iframe.setAttribute('aria-hidden', 'true');
    const receiver = { iframe, origin, key: selectedInstanceKey, transparent: !!layer.transparent, ready: false, frame: null };
    programReceivers.set(layer.id, receiver);
    programReceiverHost.append(iframe);
    const options = new URLSearchParams({ stream: '1', layer: layer.id });
    if (layer.type === 'widgets') options.set('widgetOnly','1');
    if (layer.transparent || layer.type === 'widgets') { options.set('t', '1'); options.set('c', '1'); }
    iframe.src = `${instance.url}?${options}`;
  }
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !['liturgia-stream-ready', 'liturgia-stream-frame', 'liturgia-stream-error'].includes(data.type)) return;
  const receiver = programReceivers.get(data.layerId);
  if (!receiver || event.source !== receiver.iframe.contentWindow || event.origin !== receiver.origin) {
    data.frame?.close?.();
    return;
  }
  if (data.type === 'liturgia-stream-ready') {
    receiver.ready = true;
    const layer = [currentScene(), liveSceneSnapshot]
      .filter(item => item?.custom)
      .flatMap(item => item.layers)
      .find(item => item.id === data.layerId);
    if (layer) sendProgramSourceStyles(layer);
  } else if (data.type === 'liturgia-stream-frame' && data.frame instanceof ImageBitmap) {
    receiver.frame?.close();
    receiver.frame = data.frame;
    applyScene();
  } else if (data.type === 'liturgia-stream-error') {
    sceneMessage.textContent = `Worship source: ${data.message}`;
  }
});

function selectedLayer() {
  return currentScene()?.layers?.find((layer) => layer.id === selectedLayerId) || null;
}

function applyScene() {
  const scene = currentScene();
  if (!scene) return;
  const hasProgram = sceneHasSource(scene, 'program') && (scene.custom
    ? scene.layers.some((layer) => layer.visible && layer.type === 'program' &&
      ((programSocket?.readyState===WebSocket.OPEN && programReceivers.get(layer.id)?.frame) ||
       (layer.offlineMode==='preserve' && offlineProgramImages.get(layer.id)) ||
       (layer.offlineMode==='placeholder' && layer.offlineText)))
    : !!programFrame);
  const hasCamera = sceneHasSource(scene, 'camera') && !!cameraStream;
  const hasOther = scene.custom && scene.layers.some((layer) => layer.visible && (layer.type === 'text' || layer.type === 'widgets' && !!programReceivers.get(layer.id)?.frame || (layer.type === 'image' && imageCache.get(layer.imagePath)?.complete)));
  preview.hidden = !hasProgram && !hasCamera && !hasOther;
  sceneCameraPreview.hidden = true;
  previewEmpty.hidden = hasProgram || hasCamera || hasOther;
  previewState.textContent = scene.name;
  if (!hasProgram && !hasCamera && !hasOther) {
    const needsProgram = sceneHasSource(scene, 'program');
    previewEmpty.querySelector('h2').textContent = needsProgram ? '' : sceneHasSource(scene, 'camera') ? 'Choose a camera' : 'Add a layer';
    previewEmpty.querySelector('p').textContent = needsProgram
      ? ''
      : sceneHasSource(scene, 'camera') ? 'Choose a camera on the Video Devices tab to preview this scene.' : 'Add a layer on the Scenes tab.';
  }
}

function drawContain(ctx, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.width;
  const sourceHeight = source.videoHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawCover(ctx, source, x, y, width, height) {
  const sourceWidth = source.videoWidth || source.width;
  const sourceHeight = source.videoHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  ctx.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

function drawCustomLayer(ctx, layer) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.filter = `brightness(${layer.brightness ?? 100}%) contrast(${layer.contrast ?? 100}%) saturate(${layer.saturation ?? 100}%) hue-rotate(${layer.hue ?? 0}deg)`;
  ctx.beginPath();
  ctx.rect(layer.x, layer.y, layer.width, layer.height);
  ctx.clip();
  if (layer.type === 'text') {
    ctx.fillStyle = layer.color;
    ctx.font = `600 ${layer.fontSize}px "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    const lines = layer.text.split('\n');
    lines.forEach((line, index) => ctx.fillText(line, layer.x + 12 - layer.panX * 5, layer.y + 12 - layer.panY * 5 + index * layer.fontSize * 1.2));
  } else {
    const incoming=(layer.type === 'program' || layer.type === 'widgets') && programSocket?.readyState===WebSocket.OPEN
      ? programReceivers.get(layer.id)?.frame : null;
    if (layer.type === 'program' && incoming) rememberProgramFrame(layer,incoming);
    const source = incoming || (layer.type==='program' && layer.offlineMode==='preserve' ? offlineProgramImages.get(layer.id) : null) || (layer.type === 'camera' ?
      (cameraStream && sceneCameraPreview.readyState >= 2 ? sceneCameraPreview : null) : layer.type==='image'?imageCache.get(layer.imagePath):null);
    if (!source && layer.type==='program' && layer.offlineMode==='placeholder' && layer.offlineText) {
      ctx.fillStyle='#ffffff';ctx.font='600 52px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(layer.offlineText,layer.x+layer.width/2,layer.y+layer.height/2,layer.width-32);
    }
    if (source && (layer.type !== 'image' || source.complete)) {
      const sourceWidth = source.videoWidth || source.width;
      const sourceHeight = source.videoHeight || source.height;
      const left = Math.min(layer.cropLeft, .99 - layer.cropRight);
      const top = Math.min(layer.cropTop, .99 - layer.cropBottom);
      const remainingWidth = Math.max(1, sourceWidth * (1 - left - layer.cropRight));
      const remainingHeight = Math.max(1, sourceHeight * (1 - top - layer.cropBottom));
      const sampleWidth = Math.max(1, remainingWidth / layer.zoom);
      const sampleHeight = Math.max(1, remainingHeight / layer.zoom);
      const sampleX = sourceWidth * left + (remainingWidth - sampleWidth) * (.5 + layer.panX / 200);
      const sampleY = sourceHeight * top + (remainingHeight - sampleHeight) * (.5 + layer.panY / 200);
      ctx.drawImage(source, sampleX, sampleY, sampleWidth, sampleHeight, layer.x, layer.y, layer.width, layer.height);
    }
  }
  ctx.restore();
}

function paintScene(ctx, scene) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1920, 1080);
  if (!scene) return;
  if (scene.custom) {
    for (const layer of scene.layers) drawCustomLayer(ctx, layer);
    return;
  }
  const programActive = scene.programVisible && programFrame;
  const cameraActive = scene.cameraVisible && cameraStream && sceneCameraPreview.readyState >= 2;
  if (programActive) drawContain(ctx, programFrame, 0, 0, 1920, 1080);
  else if (cameraActive) drawCover(ctx, sceneCameraPreview, 0, 0, 1920, 1080);
  if (programActive && cameraActive) {
    const width = Math.round(1920 * .32);
    const height = Math.round(width * 9 / 16);
    const x = 1920 - width - 96;
    const y = 54;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 4, y - 4, width + 8, height + 8);
    ctx.restore();
    drawCover(ctx, sceneCameraPreview, x, y, width, height);
  }
}

function drawPreview() {
  const scene = currentScene();
  paintScene(previewContext, scene);
  if (scene?.custom && !customEditor.hidden) paintScene(editorContext, scene);
  if (liveSceneSnapshot && liveProgramContext) paintScene(liveProgramContext, liveSceneSnapshot);
  const now = performance.now();
  if (now - thumbnailLastDraw > 300) {
    thumbnailLastDraw = now;
    for (const item of scenes) {
      const thumbnail = sceneThumbnailCanvases.get(item.id);
      if (!thumbnail) continue;
      const context = thumbnail.getContext('2d');
      context.save(); context.scale(thumbnail.width / 1920, thumbnail.height / 1080);
      paintScene(context, item); context.restore();
    }
  }
  requestAnimationFrame(drawPreview);
}

function acceptProgramFrame(blob) {
  pendingProgramFrame = { blob, instanceKey: selectedInstanceKey };
  if (decodingProgramFrame) return;
  decodingProgramFrame = true;
  const decodeLatest = async () => {
    while (pendingProgramFrame) {
      const pending = pendingProgramFrame;
      pendingProgramFrame = null;
      try {
        const nextFrame = await createImageBitmap(pending.blob);
        if (pending.instanceKey !== selectedInstanceKey) {
          nextFrame.close();
          continue;
        }
        const previousFrame = programFrame;
        programFrame = nextFrame;
        if (previousFrame) previousFrame.close();
        applyScene();
      } catch (error) {
        console.warn('Could not decode a Worship Program frame:', error);
      }
    }
    decodingProgramFrame = false;
  };
  void decodeLatest();
}

function renderScenes() {
  sceneList.replaceChildren();
  sceneThumbnailCanvases.clear();
  for (const scene of scenes) {
    const button = document.createElement('button');
    button.className = 'scene-card button secondary';
    button.classList.toggle('active', scene.id === activeSceneId);
    button.setAttribute('aria-pressed', scene.id === activeSceneId ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'scene-name';
    name.textContent = scene.name;
    const sources = document.createElement('span');
    sources.className = 'scene-sources';
    sources.textContent = scene.custom
      ? `${scene.layers.length} layer${scene.layers.length === 1 ? '' : 's'} · Custom`
      : [scene.cameraVisible ? 'Camera' : '', scene.programVisible ? 'Liturgia Program' : ''].filter(Boolean).join(' + ') || 'No sources';
    const thumbnail = document.createElement('canvas');
    thumbnail.className = 'scene-thumbnail';
    thumbnail.width = 192; thumbnail.height = 108;
    thumbnail.setAttribute('aria-hidden', 'true');
    sceneThumbnailCanvases.set(scene.id, thumbnail);
    button.append(thumbnail, name, sources);
    button.addEventListener('click', () => selectScene(scene.id));
    sceneList.append(button);
  }
  applyScene();
  renderCustomEditor();
  updateProgramReceivers();
}

async function selectScene(sceneId) {
  const selected = scenes.find((scene) => scene.id === sceneId);
  if (!selected) return;
  activeSceneId = sceneId;
  renderScenes();
  sceneMessage.textContent = `Previewing “${selected.name}”.`;
  markSceneChanged();
  await persistScenes();
}

function newLayer(type) {
  const base = { id: crypto.randomUUID(), type, name: { program: 'Liturgia Program', widgets: 'Worship Widgets', camera: 'Camera', image: 'Image', text: 'Text' }[type],
    x: 0, y: 0, width: 1920, height: 1080, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
    panX: 0, panY: 0, zoom: 1, opacity: 1, brightness: 100, contrast: 100, saturation: 100, hue: 0, visible: true, locked: false,
    text: type === 'text' ? 'Your text' : '', fontSize: 72, color: '#ffffff', imagePath: '', transparent: false, sourceStyles: {} };
  if (type === 'widgets') Object.assign(base, { x: 0, y: 0, width: 1920, height: 1080, transparent: true });
  if (type === 'program') Object.assign(base, { offlineMode: 'none', offlineText: '' });
  if (type === 'camera') Object.assign(base, { x: 1150, y: 60, width: 640, height: 360 });
  if (type === 'text') Object.assign(base, { x: 160, y: 820, width: 1600, height: 150 });
  return base;
}

function persistScenes() {
  markSceneChanged();
  // Serialize edits so an earlier disk write cannot overwrite a newer drag or field change.
  const snapshot = JSON.parse(JSON.stringify(scenes));
  const sceneId = activeSceneId;
  sceneSaveQueue = sceneSaveQueue.catch(() => {}).then(async () => {
    await window.liturgiaStream.saveScenes(snapshot, sceneId);
    sceneMessage.textContent = 'Scene saved.';
  }).catch((error) => { sceneMessage.textContent = `Could not save scene: ${error.message}`; });
  return sceneSaveQueue;
}

function loadLayerImage(imagePath) {
  if (!imagePath || imageCache.has(imagePath)) return;
  const image = new Image();
  imageCache.set(imagePath, image);
  window.liturgiaStream.readLayerImage(imagePath).then((url) => { image.src = url; image.onload = applyScene; })
    .catch((error) => { imageCache.delete(imagePath); sceneMessage.textContent = `Could not load image: ${error.message}`; });
}

function updateSelectionOutline() {
  const layer = selectedLayer();
  editorSelection.hidden = !layer || !layer.visible;
  if (!layer || !layer.visible) return;
  const scaleX = 100 / 1920, scaleY = 100 / 1080;
  Object.assign(editorSelection.style, {
    left: `${layer.x * scaleX}%`, top: `${layer.y * scaleY}%`,
    width: `${layer.width * scaleX}%`, height: `${layer.height * scaleY}%`
  });
}

const offlineProgramImages=new Map();
const offlineFrameSavedAt=new Map();
const offlineCaptureCanvas=document.createElement('canvas');
offlineCaptureCanvas.width=1280;offlineCaptureCanvas.height=720;
const offlineCaptureCtx=offlineCaptureCanvas.getContext('2d');
async function loadOfflineProgramFrame(layer) {
  if(offlineProgramImages.has(layer.id))return;
  offlineProgramImages.set(layer.id,null);
  try {
    const uri=await window.liturgiaStream.loadOfflineProgramFrame(layer.id);
    if(!uri)return;
    const image=new Image();
    image.onload=()=>{offlineProgramImages.set(layer.id,image)};
    image.src=uri;
  }catch(error){console.warn('Offline frame read failed:',error.message)}
}
function rememberProgramFrame(layer,frame) {
  if(layer.offlineMode!=='preserve')return;
  const now=Date.now();
  if(now-(offlineFrameSavedAt.get(layer.id)||0)<8000)return;
  offlineFrameSavedAt.set(layer.id,now);
  try {
    offlineCaptureCtx.clearRect(0,0,1280,720);
    offlineCaptureCtx.drawImage(frame,0,0,1280,720);
    const uri=offlineCaptureCanvas.toDataURL('image/webp',.72);
    const img=new Image();
    img.onload=()=>offlineProgramImages.set(layer.id,img);
    img.src=uri;
    void window.liturgiaStream.saveOfflineProgramFrame(layer.id,uri).catch(e=>console.warn('Offline frame save:',e.message));
  } catch(error) {console.warn('Offline capture:',error.message)}
}
const offlineEditor=document.getElementById('offline-program-dialog');
let offlineEditorLayerId=null;
function editOfflineProgramLayer(id){
  const layer=currentScene()?.layers?.find(item=>item.id===id);
  if(!layer || layer.type!=='program')return;
  offlineEditorLayerId=id;
  document.getElementById('offline-program-mode').value=layer.offlineMode||'none';
  document.getElementById('offline-program-text').value=layer.offlineText||'';
  offlineEditor.showModal();
}
document.getElementById('offline-program-close').onclick=()=>offlineEditor.close();
document.getElementById('offline-program-save').onclick=()=>{
  const layer=currentScene()?.layers?.find(item=>item.id===offlineEditorLayerId);
  if(!layer)return;
  layer.offlineMode=document.getElementById('offline-program-mode').value;
  layer.offlineText=document.getElementById('offline-program-text').value.slice(0,500);
  if(layer.offlineMode==='preserve')void loadOfflineProgramFrame(layer);
  offlineEditor.close();
  void persistScenes();
};

const programPicker = document.getElementById('program-display-picker');
const programStyleDialog = document.getElementById('program-style-dialog');
const programStyleFrame = document.getElementById('program-style-frame');
let programProfiles = [];
let programProfileOwnerKey = '';
let programPickerLayerId = null;
let editingProgramLayerId = null;
let editingProgramRevision = null;
let programProfileRefreshBusy = false;
let programProfilePollingTimer = null;

function profileServiceKey() {
  const chosen=instancesByKey.get(selectedInstanceKey);
  if(chosen?.styleAvailable)return selectedInstanceKey;
  const primary=[...instancesByKey.values()].find(item=>item.displayId==='0'&&item.styleAvailable
    &&chosen&&item.address===chosen.address);
  return primary?.key||'';
}
function profileForLayer(layer) {
  return programProfiles.find(p => p.id === layer?.worshipProfileId) || null;
}
async function refreshProgramDisplayProfiles() {
  if (programProfileRefreshBusy || !profileServiceKey()) return;
  programProfileRefreshBusy = true;
  const key = profileServiceKey();
  try {
    let updated = await window.liturgiaStream.getProgramDisplayProfiles(key);
    if (key !== profileServiceKey()) return;
    // First connection imports the existing Camera + Liturgia configuration
    // into Worship as a persistent named display. Later Stream computers
    // simply discover and reuse the Worship-owned profile.
    if (!updated.length) {
      const source=scenes.find(s=>s.id==='camera-program')?.layers?.find(l=>l.type==='program')
        || scenes.find(s=>s.name==='Custom Scene 1')?.layers?.find(l=>l.type==='program');
      if (source) {
        const styles={...source.sourceStyles};
        if (!styles.global) styles.global='safe-area-x: 0.04; safe-area-y: 0.69; safe-area-w: 0.92; safe-area-h: 0.27; vertical-position: bottom;';
        updated=await window.liturgiaStream.createProgramDisplayProfile(key,{
          name:'Stream Default',styles,layout:programLayoutFromLayer(source)
        });
        const builtin=scenes.find(s=>s.id==='camera-program')?.layers?.find(l=>l.type==='program');
        if(builtin && updated[0]){
          builtin.worshipProfileId=updated[0].id;
          builtin.worshipProfileRevision=updated[0].revision;
          builtin.sourceStyles=structuredClone(updated[0].styles);
          void persistScenes();
        }
      }
    }
    programProfileOwnerKey = key;
    programProfiles = updated;
    if (programPicker.open) {
      const dropdown=document.getElementById('program-picker-list');
      const selected=dropdown.value;
      dropdown.replaceChildren();
      for(const profile of updated){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;dropdown.append(option)}
      if(updated.some(p=>p.id===selected))dropdown.value=selected;
      document.getElementById('program-picker-select').disabled=!updated.length;
    }
    let changed = false;
    for (const scene of scenes) {
      if (!scene.custom) continue;
      for (const layer of scene.layers) {
        if (layer.type !== 'program' || !layer.worshipProfileId) continue;
        const remote = updated.find(p => p.id === layer.worshipProfileId);
        if (!remote || remote.revision === layer.worshipProfileRevision) continue;
        layer.sourceStyles = structuredClone(remote.styles);
        Object.assign(layer,remote.layout || {});
        layer.worshipProfileRevision = remote.revision;
        changed = true;
      }
    }
    if (changed) {
      updateProgramReceivers();
      renderCustomEditor();
      markSceneChanged();
      void persistScenes();
    }
  } catch (error) {
    // Old Worship versions may not have display profiles yet; leave sources intact.
    if (programPicker.open) document.getElementById('program-picker-status').textContent = error.message;
  } finally {
    programProfileRefreshBusy = false;
  }
}
function initProgramEditorContent() {
  if (!programStyleDialog.open || !editingProgramLayerId || !programStyleFrame.contentWindow) return;
  const layer = currentScene()?.layers?.find(l=>l.id===editingProgramLayerId);
  const profile = profileForLayer(layer);
  if (!layer || !profile) return;
  const encode = css => btoa(unescape(encodeURIComponent(css)));
  const styles = Object.fromEntries(Object.entries(profile.styles || {})
    .filter(([,css])=>typeof css === 'string' && css)
    .map(([key,css])=>[key,encode(css)]));
  const globalStyles=Object.fromEntries(Object.entries(worshipStyles||{})
    .filter(([,css])=>typeof css === 'string' && css)
    .map(([key,css])=>[key,encode(css)]));
  programStyleFrame.contentWindow.postMessage({
    type:'liturgia-program-style-init',
    payload:{ previewStyles:styles,globalStyles,content:null,displayId:0,
      displayIndex:profile.name,programProfileName:profile.name,darkMode:true,bgSnapshot:null }
  },'*');
}

async function openProgramDisplayPicker(layerId=null) {
  programPickerLayerId=layerId;
  document.getElementById('program-picker-title').textContent =
    layerId?'Choose display for this Liturgia Program layer':'Add Liturgia Program layer';
  document.getElementById('program-picker-status').textContent='';
  document.getElementById('program-new-name').value='';
  programPicker.showModal();
  await refreshProgramDisplayProfiles();
  const list=document.getElementById('program-picker-list');
  list.replaceChildren();
  for(const item of programProfiles){
    const option=document.createElement('option');
    option.value=item.id;option.textContent=item.name;
    list.append(option);
  }
  const layer=currentScene()?.layers?.find(l=>l.id===layerId);
  if (layer?.worshipProfileId && programProfiles.some(p=>p.id===layer.worshipProfileId)) list.value=layer.worshipProfileId;
  document.getElementById('program-picker-select').disabled=!programProfiles.length;
}

const PROGRAM_LAYOUT_FIELDS=['x','y','width','height','opacity','transparent',
  'cropLeft','cropTop','cropRight','cropBottom','panX','panY','zoom'];
function programLayoutFromLayer(layer) {
  return Object.fromEntries(PROGRAM_LAYOUT_FIELDS.map(key=>[key,layer[key]]).filter(([,value])=>value!==undefined));
}
let programLayoutSaveQueue=Promise.resolve();
function syncProgramLayerLayout(layer) {
  if(layer?.type!=='program'||!layer.worshipProfileId||!profileServiceKey())return;
  const id=layer.worshipProfileId;
  const layout=programLayoutFromLayer(layer);
  const key=profileServiceKey();
  programLayoutSaveQueue=programLayoutSaveQueue.catch(()=>{}).then(async()=>{
    if(key!==profileServiceKey())return;
    const profile=programProfiles.find(p=>p.id===id);
    if(!profile)return;
    try{
      const updated=await window.liturgiaStream.updateProgramDisplayProfile(key,id,{
        layout,expectedRevision:profile.revision
      });
      programProfiles=updated;
      const latest=updated.find(p=>p.id===id);
      for(const scene of scenes)for(const item of scene.layers||[])if(item.worshipProfileId===id){
        if(latest) item.worshipProfileRevision=latest.revision;
      }
      void persistScenes();
    }catch(error){
      sceneMessage.textContent='Worship layout sync: '+error.message;
      void refreshProgramDisplayProfiles();
    }
  });
}
function takeProgramProfile(profile) {
  const scene=currentScene();
  if(!scene?.custom) return;
  let layer=scene.layers.find(l=>l.id===programPickerLayerId);
  if(!layer){
    if(scene.layers.length>=20) {sceneMessage.textContent='Maximum of 20 layers reached.';return}
    layer=newLayer('program');
    layer.transparent=true;
    scene.layers.push(layer);
  }
  layer.worshipProfileId=profile.id;
  layer.worshipProfileRevision=profile.revision;
  layer.sourceStyles=structuredClone(profile.styles);
  Object.assign(layer,profile.layout||{});
  selectedLayerId=layer.id;
  programPicker.close();
  renderScenes();
  void persistScenes();
}
document.getElementById('program-picker-close').onclick=()=>programPicker.close();
document.getElementById('program-picker-select').onclick=()=>{
  const profile=programProfiles.find(p=>p.id===document.getElementById('program-picker-list').value);
  if(profile)takeProgramProfile(profile);
};
document.getElementById('program-picker-create').onclick=async()=>{
  const input=document.getElementById('program-new-name');
  const status=document.getElementById('program-picker-status');
  const name=input.value.trim();
  if(!name){status.textContent='Enter a display name.';return}
  const original=currentScene()?.layers?.find(l=>l.id===programPickerLayerId);
  try {
    const result=await window.liturgiaStream.createProgramDisplayProfile(profileServiceKey(),{
      name,styles:original?.sourceStyles || {},layout:original ? programLayoutFromLayer(original) : undefined
    });
    programProfiles=result;
    const created=result.at(-1);
    if(created)takeProgramProfile(created);
  } catch(error){status.textContent=error.message}
};
document.getElementById('program-style-change').onclick=()=>{
  const layerId=editingProgramLayerId;
  programStyleDialog.close();
  void openProgramDisplayPicker(layerId);
};
document.getElementById('program-style-close').onclick=()=>programStyleDialog.close();
programStyleDialog.addEventListener('close',()=>{editingProgramLayerId=null;editingProgramRevision=null});
programStyleFrame.addEventListener('load',initProgramEditorContent);
async function editProgramLayer(id) {
  const layer=currentScene()?.layers?.find(l=>l.id===id);
  if(!layer || layer.type!=='program')return;
  selectedLayerId=id;
  const profile=profileForLayer(layer);
  if(!profile){void openProgramDisplayPicker(id);return}
  editingProgramLayerId=id;
  editingProgramRevision=profile.revision;
  document.getElementById('program-style-title').textContent=profile.name + ' · Worship display';
  document.getElementById('program-style-status').textContent='Uses Worship’s original text styling editor. This display is shared between computers. Changes stay in Stream Preview until taken live.';
  programStyleDialog.showModal();
  initProgramEditorContent();
}
window.addEventListener('message', async event=>{
  if(event.source!==programStyleFrame.contentWindow || !programStyleDialog.open)return;
  const data=event.data;
  if(data?.type==='liturgia-program-style-close'){programStyleDialog.close();return}
  if(data?.type!=='liturgia-program-style-save')return;
  const layer=currentScene()?.layers?.find(l=>l.id===editingProgramLayerId);
  const profile=profileForLayer(layer);
  if(!profile)return;
  const decode=base64=>new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));
  const styles={};
  for(const [key,base64] of Object.entries(data.styles||{})){
    if(typeof base64==='string')styles[key]=base64?decode(base64):'';
  }
  const status=document.getElementById('program-style-status');
  status.textContent='Saving to Liturgia Worship…';
  try {
    programProfiles=await window.liturgiaStream.updateProgramDisplayProfile(profileServiceKey(),profile.id,{
      styles,expectedRevision:editingProgramRevision
    });
    await refreshProgramDisplayProfiles();
    programStyleDialog.close();
    status.textContent='Saved on Worship.';
  } catch(error){status.textContent='Could not save: '+error.message}
});
programProfilePollingTimer=window.setInterval(()=>{void refreshProgramDisplayProfiles()},4000);

function renderCustomEditor() {
  const scene = currentScene();
  customEditor.hidden = !scene?.custom;
  if (!scene?.custom) return;
  document.getElementById('custom-scene-name').value = scene.name;
  if (!scene.layers.some((layer) => layer.id === selectedLayerId)) selectedLayerId = scene.layers.at(-1)?.id || '';
  layerList.replaceChildren();
  for (let index = scene.layers.length - 1; index >= 0; index--) {
    const layer = scene.layers[index];
    if (layer.type === 'image') loadLayerImage(layer.imagePath);
    if (layer.type === 'program' && layer.offlineMode==='preserve')void loadOfflineProgramFrame(layer);
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.classList.toggle('selected', layer.id === selectedLayerId);
    const select = document.createElement('button');
    select.className = 'button secondary layer-select';
    select.textContent = layer.name;
    select.title = 'Select layer';
    select.addEventListener('click', () => { selectedLayerId = layer.id; renderCustomEditor(); });
    select.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectedLayerId = layer.id;
      renderCustomEditor();
      showLayerMenu(event);
    });
    const control = (caption, title, callback) => {
      const button = document.createElement('button');
      button.className = 'button secondary';
      const icon = document.createElement('i');
      icon.className = caption;
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      button.title = title;
      button.setAttribute('aria-label', `${title} ${layer.name}`);
      button.onclick = callback;
      row.append(button);
    };
    row.append(select);
    if (layer.type === 'program') {
      control('fa-solid fa-pen-to-square', 'Edit Worship display styles and layout', () => { void editProgramLayer(layer.id); });
      control('fa-solid fa-gear', 'Configure source when Worship disconnects', () => editOfflineProgramLayer(layer.id));
    }
    control(layer.visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash', layer.visible ? 'Hide source' : 'Show source', () => {
      layer.visible = !layer.visible; renderCustomEditor(); applyScene(); persistScenes();
    });
    control(layer.locked ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open', 'Lock or unlock', () => {
      layer.locked = !layer.locked; renderCustomEditor(); persistScenes();
    });
    control('fa-solid fa-arrow-up', 'Move forward', () => {
      if (index === scene.layers.length - 1) return;
      [scene.layers[index], scene.layers[index + 1]] = [scene.layers[index + 1], scene.layers[index]];
      renderCustomEditor(); persistScenes();
    });
    control('fa-solid fa-arrow-down', 'Move backward', () => {
      if (index === 0) return;
      [scene.layers[index], scene.layers[index - 1]] = [scene.layers[index - 1], scene.layers[index]];
      renderCustomEditor(); persistScenes();
    });
    layerList.append(row);
  }
  const layer = selectedLayer();
  layerProperties.hidden = !layer || layer.type === 'program';
  customEditor.classList.toggle('program-source-selected', layer?.type === 'program');
  worshipStyleController.setLayer(null);
  if (layer) {
    document.getElementById('layer-name').value = layer.name;
    document.getElementById('layer-text').value = layer.text;
    for (const id of ['layer-text', 'layer-text-label', 'layer-font-size-label', 'layer-color-label']) document.getElementById(id).hidden = layer.type !== 'text';
    document.getElementById('layer-color').value = layer.color;
    document.getElementById('choose-layer-image').hidden = layer.type !== 'image';
    for (const id of ['layer-appearance-heading', 'layer-appearance-note', 'layer-appearance-fields']) {
      document.getElementById(id).hidden = layer.type === 'text';
    }
    document.getElementById('layer-transparent-label').hidden = layer.type !== 'program';
    document.getElementById('layer-transparent').checked = layer.transparent === true;
    for (const input of layerProperties.querySelectorAll('[data-layer-field]')) {
      const key = input.dataset.layerField;
      const fallback = { brightness: 100, contrast: 100, saturation: 100, hue: 0 };
      const value = layer[key] ?? fallback[key];
      input.value = ['cropLeft', 'cropTop', 'cropRight', 'cropBottom', 'opacity'].includes(key) ? Math.round(value * 100) : value;
    }
  }
  updateSelectionOutline();
}

document.getElementById('create-custom-scene').addEventListener('click', () => {
  if (scenes.length >= 20) { sceneMessage.textContent = 'Maximum of 20 scenes reached.'; return; }
  const scene = { id: crypto.randomUUID(), name: `Custom Scene ${scenes.filter((item) => item.custom).length + 1}`,
    custom: true, cameraVisible: false, programVisible: false, layers: [newLayer('program')] };
  scenes.push(scene);
  activeSceneId = scene.id;
  selectedLayerId = scene.layers[0].id;
  renderScenes();
  persistScenes();
});
document.getElementById('remove-custom-scene').addEventListener('click', async () => {
  const scene = currentScene();
  if (!scene?.custom || !(await confirmAction(`Delete “${scene.name}”?`, 'Delete scene'))) return;
  scenes = scenes.filter((item) => item !== scene);
  activeSceneId = scenes[0].id;
  selectedLayerId = '';
  renderScenes();
  persistScenes();
});
document.getElementById('custom-scene-name').addEventListener('change', (event) => {
  const scene = currentScene();
  if (!scene?.custom) return;
  scene.name = event.target.value.trim().slice(0, 48) || scene.name;
  renderScenes(); persistScenes();
});
document.getElementById('add-layer').addEventListener('click', () => {
  const scene = currentScene();
  if (!scene?.custom || scene.layers.length >= 20) { sceneMessage.textContent = 'Maximum of 20 layers reached.'; return; }
  const type=document.getElementById('add-layer-type').value;
  if(type==='program' && profileServiceKey()){
    void openProgramDisplayPicker();return;
  }
  const layer = newLayer(type);
  scene.layers.push(layer);
  selectedLayerId = layer.id;
  renderScenes(); persistScenes();
});
document.getElementById('layer-transparent').addEventListener('change', (event) => {
  const layer = selectedLayer();
  if (layer?.type !== 'program') return;
  layer.transparent = event.target.checked;
  syncProgramLayerLayout(layer);
  updateProgramReceivers();
  applyScene();
  persistScenes();
});
document.getElementById('layer-name').addEventListener('change', (event) => {
  const layer = selectedLayer();
  if (!layer) return;
  layer.name = event.target.value.trim().slice(0, 48) || layer.name;
  renderCustomEditor(); persistScenes();
});
document.getElementById('layer-text').addEventListener('change', (event) => {
  const layer = selectedLayer();
  if (layer) { layer.text = event.target.value; persistScenes(); }
});
document.getElementById('layer-color').addEventListener('input', (event) => {
  const layer = selectedLayer();
  if (layer) { layer.color = event.target.value; persistScenes(); }
});
for (const input of layerProperties.querySelectorAll('[data-layer-field]')) {
  input.addEventListener('change', () => {
    const layer = selectedLayer();
    if (!layer) return;
    const field = input.dataset.layerField;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const bounds = {
      x: [-1920, 3840], y: [-1080, 2160], width: [20, 3840], height: [20, 2160],
      cropLeft: [0, .95], cropTop: [0, .95], cropRight: [0, .95], cropBottom: [0, .95],
      panX: [-100, 100], panY: [-100, 100], zoom: [1, 5], opacity: [0, 1], fontSize: [8, 300],
      brightness: [0, 200], contrast: [0, 200], saturation: [0, 200], hue: [-180, 180]
    };
    const measured = ['cropLeft', 'cropTop', 'cropRight', 'cropBottom', 'opacity'].includes(field) ? value / 100 : value;
    layer[field] = Math.max(bounds[field][0], Math.min(bounds[field][1], measured));
    if(layer.type==='program')syncProgramLayerLayout(layer);
    renderCustomEditor(); persistScenes();
  });
}
document.getElementById('layer-fit').onclick = () => {
  const layer = selectedLayer(); if (!layer) return;
  Object.assign(layer, { x: 0, y: 0, width: 1920, height: 1080 });
  if(layer.type==='program')syncProgramLayerLayout(layer);
  renderCustomEditor(); persistScenes();
};
document.getElementById('layer-center').onclick = () => {
  const layer = selectedLayer(); if (!layer) return;
  layer.x = Math.round((1920 - layer.width) / 2);
  layer.y = Math.round((1080 - layer.height) / 2);
  if(layer.type==='program')syncProgramLayerLayout(layer);
  renderCustomEditor(); persistScenes();
};
function duplicateSelectedLayer() {
  const scene = currentScene(), layer = selectedLayer();
  if (!scene?.custom || !layer) return;
  if (scene.layers.length >= 20) { sceneMessage.textContent = 'Maximum of 20 layers reached.'; return; }
  const copy = { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy`.slice(0, 48),
    x: Math.min(3840, layer.x + 40), y: Math.min(2160, layer.y + 40) };
  scene.layers.splice(scene.layers.indexOf(layer) + 1, 0, copy);
  selectedLayerId = copy.id;
  renderScenes(); persistScenes();
}
document.getElementById('layer-duplicate').onclick = duplicateSelectedLayer;
document.getElementById('layer-remove').onclick = () => {
  const scene = currentScene(); if (!scene?.custom) return;
  scene.layers = scene.layers.filter((layer) => layer.id !== selectedLayerId);
  selectedLayerId = scene.layers.at(-1)?.id || '';
  renderScenes(); persistScenes();
};
document.getElementById('choose-layer-image').onclick = async () => {
  const layer = selectedLayer(); if (!layer || layer.type !== 'image') return;
  const imagePath = await window.liturgiaStream.chooseLayerImage();
  if (!imagePath) return;
  layer.imagePath = imagePath;
  loadLayerImage(imagePath);
  persistScenes();
};

let pointerDrag = null;
function pointerCanvasPosition(event) {
  const rect = editorInteraction.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * 1920 / rect.width, y: (event.clientY - rect.top) * 1080 / rect.height };
}
editorInteraction.addEventListener('pointerdown', (event) => {
  const scene = currentScene();
  if (!scene?.custom || event.button !== 0) return;
  const { x, y } = pointerCanvasPosition(event);
  const hit = (item) => item.visible &&
    x >= item.x && y >= item.y && x <= item.x + item.width && y <= item.y + item.height;
  const layer = (selectedLayer() && hit(selectedLayer()) ? selectedLayer() : null) ||
    [...scene.layers].reverse().find(hit);
  if (!layer) { selectedLayerId = ''; renderCustomEditor(); return; }
  selectedLayerId = layer.id;
  renderCustomEditor();
  if (layer.locked) return;
  const resize = x >= layer.x + layer.width - 30 && y >= layer.y + layer.height - 30;
  pointerDrag = { id: layer.id, x, y, original: { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, resize };
  editorInteraction.setPointerCapture(event.pointerId);
});
editorInteraction.addEventListener('pointermove', (event) => {
  if (!pointerDrag) return;
  const layer = selectedLayer();
  if (!layer || layer.id !== pointerDrag.id) return;
  const { x, y } = pointerCanvasPosition(event);
  const dx = Math.round(x - pointerDrag.x), dy = Math.round(y - pointerDrag.y);
  if (pointerDrag.resize) {
    layer.width = Math.max(20, Math.min(3840, pointerDrag.original.width + dx));
    layer.height = Math.max(20, Math.min(2160, pointerDrag.original.height + dy));
  } else {
    layer.x = Math.max(-1920, Math.min(3840, pointerDrag.original.x + dx));
    layer.y = Math.max(-1080, Math.min(2160, pointerDrag.original.y + dy));
  }
  const snapping=event.shiftKey?'grid':event.ctrlKey?'align':null;
  const grid=document.getElementById('editor-snap-grid');
  const guides=document.getElementById('editor-snap-guides');
  grid.hidden=snapping!=='grid';
  guides.hidden=snapping!=='align';
  if(snapping){
    const adjusted=window.liturgiaSnap.snapBounds({...layer,id:layer.id},currentScene(),snapping);
    if(pointerDrag.resize){layer.width=adjusted.width;layer.height=adjusted.height}
    else {layer.x=adjusted.x;layer.y=adjusted.y}
    if(snapping==='align') {
      guides.querySelector('.guide-x').style.left=adjusted.guideX==null?'-100%':(adjusted.guideX/1920*100)+'%';
      guides.querySelector('.guide-y').style.top=adjusted.guideY==null?'-100%':(adjusted.guideY/1080*100)+'%';
    }
  }
  updateSelectionOutline();
});
function finishPointerDrag() {
  if (!pointerDrag) return;
  const moved=selectedLayer();
  if(moved?.type==='program')syncProgramLayerLayout(moved);
  pointerDrag = null;
  document.getElementById('editor-snap-grid').hidden=true;
  document.getElementById('editor-snap-guides').hidden=true;
  renderCustomEditor();
  persistScenes();
}
editorInteraction.addEventListener('pointerup', finishPointerDrag);
editorInteraction.addEventListener('pointercancel', finishPointerDrag);
editorInteraction.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const scene = currentScene(); if (!scene?.custom) return;
  const { x, y } = pointerCanvasPosition(event);
  const layer = [...scene.layers].reverse().find((item) => item.visible && x >= item.x && y >= item.y && x <= item.x + item.width && y <= item.y + item.height);
  if (!layer) return;
  selectedLayerId = layer.id;
  renderCustomEditor();
  showLayerMenu(event);
});

const layerMenu = document.getElementById('layer-context-menu');
function showLayerMenu(event) {
  layerMenu.hidden = false;
  layerMenu.style.left = `${Math.min(event.clientX, window.innerWidth - layerMenu.offsetWidth - 8)}px`;
  layerMenu.style.top = `${Math.min(event.clientY, window.innerHeight - layerMenu.offsetHeight - 8)}px`;
  layerMenu.querySelector('[data-menu-action="edit"]').focus();
}
layerMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  layerMenu.hidden = true;
  if (action === 'edit') {
    if (selectedLayer()?.type === 'program') void editProgramLayer(selectedLayerId);
    else layerProperties.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (action === 'duplicate') duplicateSelectedLayer();
  if (action === 'fit') document.getElementById('layer-fit').click();
  if (action === 'remove') document.getElementById('layer-remove').click();
});
document.addEventListener('pointerdown', (event) => {
  if (!layerMenu.contains(event.target)) layerMenu.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') layerMenu.hidden = true;
  const typing = event.target instanceof HTMLElement &&
    (event.target.matches('input, textarea, select, [contenteditable="true"]'));
  if (typing) return;
  const scene = currentScene();
  const layer = selectedLayer();
  if (!scene?.custom || !layer) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelectedLayer();
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    document.getElementById('layer-remove').click();
    return;
  }
  if (layer.locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const amount = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') layer.x -= amount;
  if (event.key === 'ArrowRight') layer.x += amount;
  if (event.key === 'ArrowUp') layer.y -= amount;
  if (event.key === 'ArrowDown') layer.y += amount;
  layer.x = Math.max(-1920, Math.min(3840, layer.x));
  layer.y = Math.max(-1080, Math.min(2160, layer.y));
  if(layer.type==='program')syncProgramLayerLayout(layer);
  renderCustomEditor();
  persistScenes();
});

function scheduleWorshipStyleSave() {
  window.clearTimeout(worshipStyleSaveTimer);
  worshipStyleSaveTimer = window.setTimeout(() => persistScenes(), 120);
}

const worshipStyleController = window.SourceStyleEditor.create(worshipStyleEditor, (layer) => {
  sendProgramSourceStyles(layer);
  scheduleWorshipStyleSave();
});

async function loadWorshipStyles(key) {
  const instance = instancesByKey.get(key);
  worshipStyleInstanceKey = key;
  if (!instance?.styleAvailable) {
    worshipStyles = null;
    worshipStyleController.setBaseline(null, false);
    worshipStyleController.setStatus('Worship defaults are unavailable right now. Source overrides still work and stay local to this source.');
    return;
  }
  worshipStyleController.setStatus('Loading Worship styles…');
  try {
    const styles = await window.liturgiaStream.getWorshipStyles(key);
    if (worshipStyleInstanceKey !== key) return;
    worshipStyles = styles;
    worshipStyleController.setBaseline(styles, true);
  } catch (error) {
    worshipStyles = null;
    worshipStyleController.setBaseline(null, false);
    worshipStyleController.setStatus('Could not load Worship styles: ' + error.message);
  }
}

function connectToInstance(key) {
  const instance = instancesByKey.get(key);
  if (!instance) return;
  const previous=selectedInstanceKey;
  selectedInstanceKey = key;
  if(previous !== key){programProfiles=[];programProfileOwnerKey='';}
  if (worshipStyleInstanceKey !== key) void loadWorshipStyles(key);
  void refreshProgramDisplayProfiles();
  headerStatus.classList.remove('connected');
  worshipStatus.textContent = 'Connecting to Liturgia Program';
  if (programSocket) programSocket.close();
  if (programFrame) programFrame.close();
  programFrame = null;
  updateProgramReceivers();
  applyScene();
  if (!instance.programStreamUrl) return;

  const socket = new WebSocket(instance.programStreamUrl);
  socket.binaryType = 'blob';
  programSocket = socket;
  socket.onmessage = (event) => {
    if (programSocket !== socket) return;
    if (event.data instanceof Blob) acceptProgramFrame(event.data);
    else if (event.data instanceof ArrayBuffer) acceptProgramFrame(new Blob([event.data], { type: 'image/jpeg' }));
  };
  socket.onopen = () => {
    if (programSocket === socket) renderInstances([...instancesByKey.values()]);
  };
  socket.onerror = () => {
    if (programSocket === socket) worshipStatus.textContent = 'Connecting to Liturgia Program';
  };
  socket.onclose = () => {
    if (programSocket !== socket || selectedInstanceKey !== key) return;
    programSocket = null;
    headerStatus.classList.remove('connected');
    worshipStatus.textContent = 'Reconnecting to Liturgia Program…';
    window.setTimeout(() => {
      if (selectedInstanceKey === key && instancesByKey.has(key)) connectToInstance(key);
    }, 1500);
  };
}

function renderInstances(items) {
  instancesByKey.clear();
  for (const item of items) instancesByKey.set(item.key, item);
  const list = [...instancesByKey.values()];
  if (selectedInstanceKey && !instancesByKey.has(selectedInstanceKey)) {
    selectedInstanceKey = '';
    programProfiles=[];
    programProfileOwnerKey='';
    if (programSocket) programSocket.close();
    programSocket = null;
    if (programFrame) programFrame.close();
    programFrame = null;
    updateProgramReceivers();
    applyScene();
  }
  if (!selectedInstanceKey) {
    const program = list.find((instance) => instance.displayId === '0' && instance.programStreamUrl);
    if (program) connectToInstance(program.key);
  }

  const programConnected = !!selectedInstanceKey && programSocket?.readyState === WebSocket.OPEN;
  headerStatus.classList.toggle('connected', programConnected);
  worshipStatus.textContent = programConnected
    ? 'Liturgia Program connected'
    : list.length
      ? `Found ${list.length} Worship ${list.length === 1 ? 'output' : 'outputs'}`
      : 'Looking for Worship';

  if (!list.length) {
    instanceList.innerHTML = '<p class="muted">No Worship output found yet. Make sure Worship is open and connected to this network.</p>';
    return;
  }

  instanceList.replaceChildren();
  for (const instance of list) {
    const row = document.createElement('div');
    row.className = 'instance-row';
    const title = document.createElement('span');
    title.className = 'instance-title';
    title.textContent = instance.name;
    const meta = document.createElement('span');
    meta.className = 'instance-meta';
    const outputName = instance.displayId === '0' ? 'Program' : (instance.displayId || 'Program');
    meta.textContent = `Output ${outputName} · ${instance.address} · Liturgia ${instance.version || 'Worship'}`;
    const button = document.createElement('button');
    button.className = 'button secondary';
    button.textContent = selectedInstanceKey === instance.key && programSocket?.readyState === WebSocket.OPEN
      ? 'Connected' : 'Connect';
    button.addEventListener('click', () => connectToInstance(instance.key));
    row.append(title, meta, button);
    instanceList.append(row);
  }
}

window.liturgiaStream.onWorshipInstances(renderInstances);
document.getElementById('refresh-worship').addEventListener('click', async () => {
  instanceList.innerHTML = '<p class="muted">Searching your local network…</p>';
  renderInstances(await window.liturgiaStream.refreshWorship());
});
window.liturgiaStream.getWorshipInstances().then(renderInstances);

let cameraStream = null;
async function refreshVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const select = document.getElementById('video-device');
  const previous = select.value || selectedDevices.cameraId || '';
  select.replaceChildren(new Option(cameras.length ? 'Choose a camera' : 'No camera found', ''));
  for (const device of cameras) select.add(new Option(device.label || 'Camera', device.deviceId));
  if (cameras.some((device) => device.deviceId === previous)) select.value = previous;
  document.getElementById('video-message').textContent = cameras.length
    ? `${cameras.length} camera ${cameras.length === 1 ? 'device' : 'devices'} found.`
    : 'No camera found. Connect a webcam or capture card, then refresh.';
}
document.getElementById('refresh-video').addEventListener('click', refreshVideoDevices);
document.getElementById('enable-video').addEventListener('click', async () => {
  try {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await refreshVideoDevices();
    const video = document.getElementById('camera-preview');
    video.srcObject = cameraStream;
    sceneCameraPreview.srcObject = cameraStream;
    applyScene();
    video.hidden = false;
    document.getElementById('video-message').textContent = 'Camera preview is active. Select your camera above.';
  } catch (error) {
    document.getElementById('video-message').textContent = `Camera access failed: ${error.message}`;
  }
});
document.getElementById('video-device').addEventListener('change', async (event) => {
  selectedDevices.cameraId = event.target.value;
  await saveDeviceSelections();
  if (!event.target.value) return;
  try {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: event.target.value } }, audio: false });
    const video = document.getElementById('camera-preview');
    video.srcObject = cameraStream;
    sceneCameraPreview.srcObject = cameraStream;
    applyScene();
    video.hidden = false;
    document.getElementById('video-message').textContent = 'Camera preview is active.';
  } catch (error) {
    document.getElementById('video-message').textContent = `Could not start this camera: ${error.message}`;
  }
});

let audioStream = null;
let audioContext = null;
let meterFrame = 0;
async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const select = document.getElementById('audio-device');
  const previous = select.value || selectedDevices.microphoneId || '';
  select.replaceChildren(new Option(microphones.length ? 'Choose a microphone' : 'No microphone found', ''));
  for (const device of microphones) select.add(new Option(device.label || 'Microphone', device.deviceId));
  if (microphones.some((device) => device.deviceId === previous)) select.value = previous;
  document.getElementById('audio-message').textContent = microphones.length
    ? `${microphones.length} microphone ${microphones.length === 1 ? 'device' : 'devices'} found.`
    : 'No microphone found. Connect a microphone, then refresh.';
}
async function startMicrophoneMeter(deviceId) {
  audioStream?.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close();
  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false
  });
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  audioContext.createMediaStreamSource(audioStream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const bar = document.getElementById('audio-level');
  const draw = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    const level = Math.min(100, Math.sqrt(sum / data.length) * 180);
    bar.style.width = `${level}%`;
    meterFrame = requestAnimationFrame(draw);
  };
  cancelAnimationFrame(meterFrame);
  draw();
}
document.getElementById('refresh-audio').addEventListener('click', refreshAudioDevices);
document.getElementById('enable-audio').addEventListener('click', async () => {
  try {
    await startMicrophoneMeter(document.getElementById('audio-device').value);
    await refreshAudioDevices();
    document.getElementById('audio-message').textContent = 'Microphone is active. Speak to check the level meter.';
  } catch (error) {
    document.getElementById('audio-message').textContent = `Microphone access failed: ${error.message}`;
  }
});
document.getElementById('audio-device').addEventListener('change', async (event) => {
  selectedDevices.microphoneId = event.target.value;
  await saveDeviceSelections();
  if (!event.target.value) return;
  try {
    await startMicrophoneMeter(event.target.value);
    document.getElementById('audio-message').textContent = 'Microphone is active. Speak to check the level meter.';
  } catch (error) {
    document.getElementById('audio-message').textContent = `Could not start this microphone: ${error.message}`;
  }
});

const presetOutput = {
  '720p30': { width: 1280, height: 720, fps: 30 },
  '1080p30': { width: 1920, height: 1080, fps: 30 },
  '1080p60': { width: 1920, height: 1080, fps: 60 }
};
const destinationStatus = document.getElementById('destination-status');
const saveDestinationButton = document.getElementById('save-destination');
const applyLiveSettingsButton = document.getElementById('apply-live-settings');
const destinationGrid = document.getElementById('destination-cards');
const destinationEditor = document.getElementById('destination-editor');
const destinationEditorForm = document.getElementById('destination-editor-form');
let editingDestinationId = null;
let destinations = [];
const destinationStates = new Map();
const destinationErrors = new Map();
let pendingSavedStreamConfig = null;

function destinationState(id) {
  return destinationStates.get(id) || 'offline';
}
const facebookConnectionErrors = new Map();
const facebookSessionValid = new Map();
async function refreshFacebookSessions() {
  await Promise.all(destinations.filter(isFacebookDestination).map(async d => {
    try { const result = await window.liturgiaStream.getFacebookProducerSession(d.id); facebookSessionValid.set(d.id, !!result?.valid); }
    catch (_) { facebookSessionValid.set(d.id, false); }
  }));
  renderDestinationCards();
}
const facebookConnectionTimers = new Map();
const facebookConnectionStartedAt = new Map();
function clearFacebookConnectionTimer(id) {
  const timer = facebookConnectionTimers.get(id);
  if (timer) clearTimeout(timer);
  facebookConnectionTimers.delete(id);
}
function scheduleFacebookConnectionHelp(id) {
  if (!facebookConnectionStartedAt.has(id)) facebookConnectionStartedAt.set(id, Date.now());
  clearFacebookConnectionTimer(id);
  facebookConnectionTimers.set(id, setTimeout(() => {
    facebookConnectionTimers.delete(id);
    const item = destinations.find(d => d.id === id);
    if (!item || !isFacebookDestination(item) || destinationState(id) !== 'connecting') return;
    facebookConnectionErrors.set(id, 1);
    destinationErrors.set(id, 'Facebook has not accepted the connection yet. Open Producer and select Streaming software.');
    renderDestinationCards();
  }, 10000));
}
let facebookPublishRequested = false;
function isFacebookDestination(item) {
  if (!item) return false;
  // User-provided labels and standard Meta ingest hostnames must both work.
  if (/facebook|meta live/i.test(String(item.name || ''))) return true;
  try { return /(^|\.)(facebook\.com|fbcdn\.net)$/i.test(new URL(item.server).hostname); }
  catch (_) { return false; }
}
function facebookHelpButton(item) {
  if (!isFacebookDestination(item)) return null;
  const current = destinationState(item.id);
  const needsHelp = facebookSessionValid.get(item.id) !== true ||
    facebookPublishRequested || facebookConnectionErrors.has(item.id) ||
    current === 'reconnecting' || (current === 'connecting' && facebookConnectionStartedAt.has(item.id) && Date.now() - facebookConnectionStartedAt.get(item.id) >= 10000);
  if (!needsHelp) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'facebook-connection-help';
  const linkIcon = document.createElement('i');
  linkIcon.className = 'fa-solid fa-link';
  linkIcon.setAttribute('aria-hidden', 'true');
  button.append(linkIcon);
  button.title = 'Open Facebook Live Producer to configure streaming software';
  button.setAttribute('aria-label', 'Open Facebook Live Producer for ' + item.name);
  button.addEventListener('click', () => { void window.liturgiaStream.openFacebookProducer(facebookPublishRequested ? 'publish' : 'connect', item.id); });
  return button;
}

function renderDestinationCards() {
  destinationGrid.replaceChildren();
  for (const item of destinations) {
    const tile = document.createElement('div');
    tile.className = 'destination-tile';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'destination-connect';
    open.setAttribute('aria-label', 'Connect or disconnect ' + item.name);
    const name = document.createElement('strong');
    name.textContent = item.name;
    const state = document.createElement('span');
    state.className = 'destination-state destination-state-' + destinationState(item.id);
    const current = destinationState(item.id);
    state.textContent = current === 'offline' ? 'Click to connect' :
      current === 'live' ? 'Sending stream · click to disconnect' :
      current === 'reconnecting' ? 'Reconnecting · click to disconnect' :
      current === 'connecting' ? 'Connecting · click to disconnect' : 'Click to connect';
    const host = document.createElement('small');
    if (current === 'reconnecting' && destinationErrors.has(item.id)) {
      const failure = document.createElement('small');
      failure.className = 'destination-error-detail';
      failure.textContent = destinationErrors.get(item.id);
      open.append(failure);
    }
    try { host.textContent = new URL(item.server).hostname; } catch (_) { host.textContent = 'RTMP destination'; }
    open.append(name, host, state);
    open.addEventListener('click', () => { void toggleDestination(item.id); });
    const actions = document.createElement('div');
    actions.className = 'destination-tile-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>'; edit.title = 'Edit ' + item.name;
    edit.setAttribute('aria-label', 'Edit ' + item.name);
    edit.addEventListener('click', () => openDestinationEditor(item.id));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i>'; remove.title = 'Delete ' + item.name;
    remove.className = 'destination-tile-trash';
    remove.setAttribute('aria-label', 'Delete ' + item.name);
    remove.addEventListener('click', () => { void deleteDestination(item.id); });
    const fbHelp = facebookHelpButton(item);
    if (fbHelp) actions.append(fbHelp);
    actions.append(edit, remove);
    tile.append(open, actions);
    destinationGrid.append(tile);
  }
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'destination-add';
  add.setAttribute('aria-label', 'Add streaming destination');
  const plus = document.createElement('span'); plus.textContent = '+';
  const label = document.createElement('small'); label.textContent = 'Add destination';
  add.append(plus, label);
  add.addEventListener('click', () => openDestinationEditor(null));
  destinationGrid.append(add);
  if (typeof renderLiveDestinations === 'function') renderLiveDestinations();
}

function openDestinationEditor(id) {
  editingDestinationId = id;
  const item = destinations.find(d => d.id === id);
  document.getElementById('destination-editor-title').textContent = item ? 'Edit destination' : 'Add destination';
  document.getElementById('destination-name').value = item?.name || '';
  document.getElementById('stream-server').value = item?.server || '';
  document.getElementById('stream-key').value = '';
  document.getElementById('stream-key').placeholder = item?.keySaved ? 'Saved securely · leave blank to keep' : 'Enter stream key';
  document.getElementById('delete-destination-in-editor').hidden = !item;
  destinationEditor.showModal();
  document.getElementById('destination-name').focus();
}
function closeDestinationEditor() { destinationEditor.close(); editingDestinationId = null; }
document.getElementById('destination-editor-close').addEventListener('click', closeDestinationEditor);
document.getElementById('cancel-destination-edit').addEventListener('click', closeDestinationEditor);
destinationEditor.addEventListener('close', () => { editingDestinationId = null; });

async function refreshDestinationList() {
  const config = await window.liturgiaStream.getConfig();
  destinations = Array.isArray(config.destinations) ? config.destinations : [];
  await refreshFacebookSessions();
  renderDestinationCards();
  return config;
}

async function deleteDestination(id) {
  const item = destinations.find(d => d.id === id);
  if (!item) return;
  if (!(await confirmAction('Delete ' + item.name + '? The saved stream key will be deleted too.', 'Delete destination'))) return;
  try {
    await window.liturgiaStream.deleteDestination(id);
    destinationStates.delete(id);
    if (destinationEditor.open) closeDestinationEditor();
    await refreshDestinationList();
    destinationStatus.textContent = item.name + ' deleted.';
  } catch (error) { destinationStatus.textContent = error.message; }
}
document.getElementById('delete-destination-in-editor').addEventListener('click', () => {
  const id = editingDestinationId;
  if (id) void deleteDestination(id);
});

destinationEditorForm.addEventListener('submit', async event => {
  event.preventDefault();
  saveDestinationButton.disabled = true;
  try {
    const saved = await window.liturgiaStream.saveDestination({
      id: editingDestinationId,
      name: document.getElementById('destination-name').value,
      server: document.getElementById('stream-server').value,
      streamKey: document.getElementById('stream-key').value
    });
    const wasConnected = destinationState(saved.id) !== 'offline';
    closeDestinationEditor();
    await refreshDestinationList();
    destinationStatus.textContent = saved.name + (wasConnected
      ? ' saved. Disconnect and reconnect this destination to apply the new server/key.'
      : ' saved securely.');
  } catch (error) {
    destinationStatus.textContent = error.message;
  } finally { saveDestinationButton.disabled = false; }
});

async function loadEncoderInfo() {
  const infoElement = document.getElementById('encoder-info');
  try {
    const info = await window.liturgiaStream.getEncoderInfo();
    infoElement.textContent = info.available
      ? 'Available in FFmpeg: ' + info.supported.join(', ') + '. One encoder is shared by all destinations.'
      : info.error;
  } catch (error) { infoElement.textContent = 'Encoder detection failed: ' + error.message; }
}

async function loadStreamConfig() {
  try {
    const config = await refreshDestinationList();
    selectedDevices = config.devices || selectedDevices;
    scenes = Array.isArray(config.scenes) ? config.scenes : [];
    activeSceneId = config.activeSceneId || 'camera-program';
    renderScenes();
    const output = config.output || {};
    const preset = Object.entries(presetOutput).find(([, value]) =>
      value.width === output.width && value.height === output.height && value.fps === output.fps
    );
    if (preset) document.getElementById('output-preset').value = preset[0];
    if (Number.isFinite(output.videoBitrateKbps)) document.getElementById('video-bitrate').value = output.videoBitrateKbps;
    if (Number.isFinite(output.audioBitrateKbps)) document.getElementById('audio-bitrate').value = output.audioBitrateKbps;
    destinationStatus.textContent = destinations.length
      ? destinations.length + ' destination(s) saved securely.' : 'Add a destination to begin.';
  } catch (error) { destinationStatus.textContent = 'Could not load saved settings: ' + error.message; }
}

document.getElementById('save-quality').addEventListener('click', async () => {
  const preset = presetOutput[document.getElementById('output-preset').value] || presetOutput['1080p30'];
  try {
    const output = await window.liturgiaStream.saveQuality({
      ...preset,
      videoBitrateKbps: Number(document.getElementById('video-bitrate').value) || 6000,
      audioBitrateKbps: Number(document.getElementById('audio-bitrate').value) || 160,
      audioSampleRate: 48000
    });
    if (outputActive) {
      pendingSavedStreamConfig = { output };
      applyLiveSettingsButton.hidden = false;
      destinationStatus.textContent = 'Quality saved. Apply it to restart the shared encoder, or leave the current stream running.';
    } else {
      pendingSavedStreamConfig = null;
      applyLiveSettingsButton.hidden = true;
      destinationStatus.textContent = 'Shared quality saved.';
    }
  } catch (error) { destinationStatus.textContent = error.message; }
});

let outputActive = false;
let userStoppingOutput = false;
let applyingStreamSettings = false;
let outputAudioContext = null;
let outputSilentSource = null;
let outputCanvasStream = null;
let outputComposedStream = null;
let outputMediaRecorder = null;
let outputReconnectPreparation = Promise.resolve();
let outputPendingWrites = new Set();
let outputChunkWriteQueue = Promise.resolve();
let outputStartedAt = 0;
let outputClockTimer = null;
let currentOutputConfig = { width: 1920, height: 1080, fps: 30, videoBitrateKbps: 6000, audioBitrateKbps: 160, audioSampleRate: 48000 };
const goLiveButton = document.getElementById('go-live');
const streamStatusLabel = document.getElementById('stream-status-label');
const streamStatusDetail = document.getElementById('stream-status-detail');
const largeStatusDot = document.querySelector('.large-dot');
const streamElapsed = document.getElementById('stream-elapsed');

function updateStreamElapsed() {
  if (!outputStartedAt) return;
  const seconds = Math.floor((Date.now() - outputStartedAt) / 1000);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  streamElapsed.textContent = `Duration ${hours}:${minutes}:${remainder}`;
}

async function ensureCameraReady() {
  if (cameraStream) return;
  if (!selectedDevices.cameraId) throw new Error('Choose a camera on the Video Devices tab first.');
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: selectedDevices.cameraId } },
    audio: false
  });
  document.getElementById('camera-preview').srcObject = cameraStream;
  sceneCameraPreview.srcObject = cameraStream;
  applyScene();
}

async function ensureMicrophoneReady() {
  if (audioStream) return;
  if (!selectedDevices.microphoneId) throw new Error('Choose a microphone on the Audio Devices tab first.');
  await startMicrophoneMeter(selectedDevices.microphoneId);
}

function cleanupOutputCapture() {
  outputComposedStream?.getTracks().forEach((track) => track.stop());
  outputComposedStream = null;
  if (outputCanvasStream) outputCanvasStream.getTracks().forEach((track) => track.stop());
  outputCanvasStream = null;
  if (outputSilentSource) outputSilentSource.stop();
  outputSilentSource = null;
  if (outputAudioContext) outputAudioContext.close();
  outputAudioContext = null;
  outputMediaRecorder = null;
}

async function stopOutputRecorder() {
  const recorder = outputMediaRecorder;
  // Invalidate this generation synchronously. Old WebM chunks must never be
  // sent to a replacement FFmpeg process, even during the recorder's stop event.
  outputMediaRecorder = null;
  if (recorder && recorder.state !== 'inactive') {
    await new Promise((resolve) => {
      recorder.addEventListener('stop', resolve, { once: true });
      try { recorder.stop(); } catch (_) { resolve(); }
    });
  }
  await Promise.allSettled([...outputPendingWrites]);
  cleanupOutputCapture();
}

async function startOutputRecorder() {
  if (outputMediaRecorder && outputMediaRecorder.state === 'recording') return;
  const scene = liveSceneSnapshot || currentScene();
  if (!scene) throw new Error('Choose a scene before going live.');
  if (sceneHasSource(scene, 'camera') && !cameraStream) await ensureCameraReady();
  if (sceneHasSource(scene, 'program')) {
    const ready = () => scene.custom
      ? scene.layers.some(layer => layer.visible && layer.type === 'program' && programReceivers.get(layer.id)?.frame)
      : !!programFrame;
    // A newly taken scene's dedicated live receiver may load after the encoder.
    for (let attempt = 0; !ready() && attempt < 40 && outputActive && !userStoppingOutput; attempt++) {
      await new Promise(resolve => window.setTimeout(resolve, 150));
    }
    if (!ready()) throw new Error('Waiting for the live Liturgia Program source. Make sure Worship is presenting.');
  }
  if (selectedDevices.microphoneId) await ensureMicrophoneReady();

  if (!liveProgramCanvas) {
    liveProgramCanvas = document.createElement('canvas');
    liveProgramCanvas.width = 1920;
    liveProgramCanvas.height = 1080;
    liveProgramContext = liveProgramCanvas.getContext('2d');
  }
  if (!liveSceneSnapshot) {
    liveSceneSnapshot = cloneSceneForLive(currentScene());
    updateProgramReceivers();
  }
  outputCanvasStream = liveProgramCanvas.captureStream(currentOutputConfig.fps);
  outputAudioContext = new AudioContext({ sampleRate: currentOutputConfig.audioSampleRate });
  await outputAudioContext.resume();
  const destination = outputAudioContext.createMediaStreamDestination();
  if (audioStream) {
    outputAudioContext.createMediaStreamSource(audioStream).connect(destination);
  } else {
    outputSilentSource = outputAudioContext.createConstantSource();
    const silence = outputAudioContext.createGain();
    silence.gain.value = 0;
    outputSilentSource.connect(silence).connect(destination);
    outputSilentSource.start();
  }
  outputComposedStream = new MediaStream([
    ...outputCanvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks()
  ]);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';
  const recorder = new MediaRecorder(outputComposedStream, {
    mimeType,
    videoBitsPerSecond: Math.max(2500000, currentOutputConfig.videoBitrateKbps * 1000),
    audioBitsPerSecond: currentOutputConfig.audioBitrateKbps * 1000
  });
  outputMediaRecorder = recorder;
  recorder.ondataavailable = (event) => {
    if (!event.data || !event.data.size || !outputActive || outputMediaRecorder !== recorder) return;
    // Blob.arrayBuffer() and IPC are asynchronous: serialize them so FFmpeg
    // always sees the EBML header before any following WebM media chunks.
    const write = outputChunkWriteQueue.then(async () => {
      if (!outputActive || outputMediaRecorder !== recorder) return;
      const data = await event.data.arrayBuffer();
      if (!outputActive || outputMediaRecorder !== recorder) return;
      await window.liturgiaStream.sendOutputChunk(data);
    }).catch((error) => {
      if (outputActive && !userStoppingOutput && outputMediaRecorder === recorder) {
        streamStatusDetail.textContent = error.message;
      }
    });
    outputChunkWriteQueue = write;
    outputPendingWrites.add(write);
    void write.finally(() => outputPendingWrites.delete(write));
  };
  recorder.onerror = (event) => {
    streamStatusDetail.textContent = event.error?.message || 'The local video input stopped.';
  };
  recorder.start(100);
}


function renderLiveDestinations() {
  const list = document.getElementById('live-target-statuses');
  if (!list) return;
  list.replaceChildren();
  for (const d of destinations) {
    const line = document.createElement('div');
    line.className = 'live-target-row';
    const name = document.createElement('span');
    name.textContent = d.name;
    const state = document.createElement('span');
    state.className = 'destination-state destination-state-' + destinationState(d.id);
    const current = destinationState(d.id);
    state.textContent = current === 'offline' ? 'Offline' : current === 'live' ? 'Sending video' :
      current === 'reconnecting' ? 'Retrying' : 'Connecting';
    line.append(name, state);
    if (current === 'reconnecting' && destinationErrors.has(d.id)) {
      const failure = document.createElement('span');
      failure.className = 'destination-error-detail';
      failure.title = destinationErrors.get(d.id);
      failure.textContent = destinationErrors.get(d.id);
      line.append(failure);
    }
    const fbHelp = facebookHelpButton(d);
    if (fbHelp) line.append(fbHelp);
    list.append(line);
  }
  const facebookPublishButton = document.getElementById('facebook-publish-guide');
  if (facebookPublishButton) facebookPublishButton.hidden = !facebookPublishRequested || !destinations.some(isFacebookDestination);
  const anyActive = destinations.some(d => destinationState(d.id) !== 'offline');
  const allActive = destinations.length > 0 && destinations.every(d => destinationState(d.id) !== 'offline');
  goLiveButton.textContent = allActive ? 'Stop all outputs' :
    anyActive ? 'Connect remaining & start all' : 'Connect & start all';
}
async function toggleDestination(id) {
  facebookPublishRequested = false;
  const item = destinations.find(d => d.id === id);
  if (!item) return;
  if (destinationState(id) !== 'offline') {
    try {
      destinationStates.set(id, 'offline');
      await window.liturgiaStream.stopOutput(id);
      renderDestinationCards();
    } catch (error) { destinationStatus.textContent = error.message; }
    return;
  }
  try {
    const config = await checkLiveReadiness();
    currentOutputConfig = { ...currentOutputConfig, ...(config.output || {}) };
    if (!outputActive) applySceneChangesLive();
    outputActive = true;
    destinationStates.set(id, 'connecting');
    renderDestinationCards();
    await window.liturgiaStream.startOutput([id]);
  } catch (error) {
    destinationStates.set(id, 'offline');
    if (![...destinationStates.values()].some(s => s !== 'offline')) outputActive = false;
    destinationStatus.textContent = error.message;
    renderDestinationCards();
  }
}
window.liturgiaStream.onFacebookHelp(id => {
  const d = destinations.find(x => x.id === id);
  if (!d) return;
  streamStatusDetail.textContent = 'Facebook RTMP connection failed for ' + d.name +
    '. Check the connection details and stream key. Producer can help confirm whether Facebook is receiving video. Only press Go Live after a preview appears.';
  document.getElementById('facebook-producer-help').hidden = false;
});
document.getElementById('facebook-publish-guide').addEventListener('click', () => {
  facebookPublishRequested = true;
  renderDestinationCards();
  streamStatusDetail.textContent = 'Facebook is receiving video. Click the pulsing link next to Facebook to open Producer and publish.';
});
document.getElementById('facebook-producer-help').addEventListener('click', () => {
  const source = destinations.find(d => isFacebookDestination(d) && destinationState(d.id) === 'reconnecting') || destinations.find(isFacebookDestination);
  void window.liturgiaStream.openFacebookProducer(facebookPublishRequested ? 'publish' : 'connect', source?.id);
});
document.getElementById('apply-scene-live').addEventListener('click', () => {
  if (!outputActive || !sceneChangesPending) return;
  applySceneChangesLive();
  streamStatusDetail.textContent = 'Live program switched to ' + (currentScene()?.name || 'the selected scene') + '.';
});

async function handleOutputStatus(status) {
  if (status.sourceId) {
    if (status.state === 'stopped' || status.state === 'live') {
      clearFacebookConnectionTimer(status.sourceId);
      facebookConnectionStartedAt.delete(status.sourceId);
    }
    if (status.state === 'reconnecting') destinationErrors.set(status.sourceId, String(status.error || 'Connection interrupted.').replace(/rtmps?:\/\/\S+/gi, '[stream destination]').slice(0, 180));
    if (status.state === 'live' || status.state === 'stopped') destinationErrors.delete(status.sourceId);
    const fbDestination = destinations.find(d => d.id === status.sourceId);
    if (fbDestination && isFacebookDestination(fbDestination)) {
      if (status.state === 'connecting') scheduleFacebookConnectionHelp(status.sourceId);
      if (status.state === 'reconnecting') {
        clearFacebookConnectionTimer(status.sourceId);
        facebookConnectionErrors.set(status.sourceId, Math.min(2, (facebookConnectionErrors.get(status.sourceId) || 0) + 1));
      } else if (status.state === 'live') {
        clearFacebookConnectionTimer(status.sourceId);
        facebookConnectionErrors.delete(status.sourceId);
      }
    }
    destinationStates.set(status.sourceId, status.state === 'stopped' ? 'offline' : status.state);
    renderDestinationCards();
    if (status.state === 'live') {
      if (!outputStartedAt) {
        outputStartedAt = Date.now();
        streamElapsed.hidden = false;
        updateStreamElapsed();
        outputClockTimer = window.setInterval(updateStreamElapsed, 1000);
      }
      streamStatusLabel.textContent = 'Sending video';
      largeStatusDot.classList.add('live');
    }
    if (status.state === 'reconnecting') {
      streamStatusLabel.textContent = 'Destination reconnecting';
      streamStatusDetail.textContent = (status.name || 'Destination') + ': ' + (status.error || 'Connection interrupted.') +
        ' Retrying in ' + Math.ceil((status.retryInMs || 0) / 1000) + ' seconds.';
    }
    return;
  }
  if (status.state === 'awaiting-input') {
    try {
      await outputReconnectPreparation;
      if (outputActive && !userStoppingOutput) await startOutputRecorder();
    } catch (error) {
      streamStatusDetail.textContent = error.message;
      await stopLiveStream();
    }
    streamStatusLabel.textContent = 'Connecting…';
  } else if (status.state === 'live') {
    if (!outputStartedAt) {
      outputStartedAt = Date.now();
      streamElapsed.hidden = false;
      updateStreamElapsed();
      outputClockTimer = window.setInterval(updateStreamElapsed, 1000);
    }
    streamStatusLabel.textContent = 'Sending video';
    largeStatusDot.classList.add('live');
    const fps = Number.isFinite(status.fps) ? `${Math.round(status.fps)} FPS` : 'Sending video';
    const bitrate = status.bitrate ? ` · ${status.bitrate}` : '';
    const dropped = Number.isFinite(status.droppedFrames) ? ` | ${status.droppedFrames} dropped` : '';
    const resolution = `${currentOutputConfig.width}x${currentOutputConfig.height}`;
    streamStatusDetail.textContent = `${resolution} @ ${fps}${bitrate}${dropped}`;
  } else if (status.state === 'reconnecting') {
    streamStatusLabel.textContent = 'Connection lost';
    largeStatusDot.classList.remove('live');
    const delay = status.retryInMs ? ` Retrying in ${Math.ceil(status.retryInMs / 1000)} seconds.` : ' Retrying now.';
    const rejected = /Error opening output|Error opening output files|IO error: End of file/i.test(status.error || '');
    const reason = String(status.error || '').trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 220);
    if (rejected) streamStatusLabel.textContent = 'Destination disconnected';
    streamStatusDetail.textContent = rejected
      ? `The destination closed the connection. Check its stream key and broadcast setup.${delay}${reason ? ` Encoder: ${reason}` : ''}`
      : `${reason ? `Encoder: ${reason}` : 'Connection interrupted.'}${delay}`;
    outputReconnectPreparation = stopOutputRecorder();
  } else if (status.state === 'stopping') {
    streamStatusLabel.textContent = 'Ending stream…';
  } else if (status.state === 'stopped') {
    outputActive = false;
    liveSceneSnapshot = null;
    sceneChangesPending = false;
    document.getElementById('apply-scene-live').hidden = true;
    updateProgramReceivers();
    // This also happens when the final card is disconnected individually.
    // Release MediaRecorder/audio tracks even without a global Stop click.
    void stopOutputRecorder();
    userStoppingOutput = false;
    pendingSavedStreamConfig = null;
    applyLiveSettingsButton.hidden = true;
    outputStartedAt = 0;
    if (outputClockTimer !== null) window.clearInterval(outputClockTimer);
    outputClockTimer = null;
    streamElapsed.hidden = true;
    streamElapsed.textContent = 'Duration 00:00:00';
    largeStatusDot.classList.remove('live');
    streamStatusLabel.textContent = 'Not streaming';
    streamStatusDetail.textContent = 'Your settings are saved for next time.';
    destinationStates.clear();
    renderDestinationCards();
    goLiveButton.disabled = false;
  } else if (status.state === 'connecting') {
    streamStatusLabel.textContent = 'Starting…';
    streamStatusDetail.textContent = status.message || 'Starting the stream encoder.';
  }
  if (outputActive && status.state !== 'stopped') {
    renderLiveDestinations();
    goLiveButton.disabled = applyingStreamSettings;
  }
  if (applyingStreamSettings) goLiveButton.disabled = true;
  // Keep Run Update disabled if a stream starts after the download completed.
  if (typeof currentUpdateState !== 'undefined') renderUpdateStatus(currentUpdateState);
}

async function stopLiveStream() {
  if (!outputActive) return;
  userStoppingOutput = true;
  goLiveButton.disabled = true;
  await stopOutputRecorder();
  await window.liturgiaStream.stopOutput();
}

async function checkLiveReadiness() {
  const config = await window.liturgiaStream.getConfig();
  if (!config.destinations?.length) throw new Error('Add at least one stream destination first.');
  if (!config.destinations.some(d => d.keySaved)) throw new Error('Enter a stream key for a destination first.');
  // Adding an output while already live must not depend on a scene that is
  // only staged in Preview: the existing on-air snapshot remains authoritative.
  if (outputActive && liveSceneSnapshot) return config;
  const scene = currentScene();
  if (!scene || (scene.custom ? !scene.layers.some((layer) => layer.visible) : !scene.cameraVisible && !scene.programVisible)) throw new Error('Choose a scene with a visible source.');
  if (sceneHasSource(scene, 'camera') && !selectedDevices.cameraId) {
    throw new Error('This scene needs a camera. Select one on Video Devices, or choose Liturgia Fullscreen on Scenes.');
  }
  if (sceneHasSource(scene, 'program') && (scene.custom
    ? !scene.layers.some((layer) => layer.type === 'program' && layer.visible && programReceivers.get(layer.id)?.frame)
    : !programFrame)) throw new Error('Waiting for Liturgia Program video. Make sure Worship is presenting.');
  return config;
}

async function startLiveStream(config) {
  const scene = currentScene();
  if (sceneHasSource(scene, 'camera')) await ensureCameraReady();
  if (selectedDevices.microphoneId) await ensureMicrophoneReady();
  currentOutputConfig = { ...currentOutputConfig, ...(config.output || {}) };
  if (!outputActive) applySceneChangesLive();
  outputActive = true;
  goLiveButton.textContent = 'Starting…';
  goLiveButton.disabled = true;
  streamStatusDetail.textContent = 'Connecting to your streaming destination…';
  try {
    await window.liturgiaStream.startOutput();
  } catch (error) {
    outputActive = false;
    renderLiveDestinations();
    goLiveButton.disabled = false;
    throw error;
  }
}

applyLiveSettingsButton.addEventListener('click', async () => {
  if (!outputActive || !pendingSavedStreamConfig || applyingStreamSettings) return;
  const approved = await confirmAction(
    'Applying new encoder settings requires a brief stream disconnect. Facebook may interrupt an active broadcast. Reconnect now?',
    'Reconnect now'
  );
  if (!approved || !outputActive || !pendingSavedStreamConfig || applyingStreamSettings) return;
  const config = pendingSavedStreamConfig;
  applyingStreamSettings = true;
  applyLiveSettingsButton.disabled = true;
  goLiveButton.disabled = true;
  destinationStatus.textContent = 'Restarting encoder with saved settings. Facebook may briefly lose the feed.';
  try {
    await stopLiveStream();
    await startLiveStream(config);
    pendingSavedStreamConfig = null;
    applyLiveSettingsButton.hidden = true;
    destinationStatus.textContent = `Reconnecting at ${config.output.videoBitrateKbps} kbps video. Check Live for the incoming bitrate.`;
  } catch (error) {
    destinationStatus.textContent = `Could not reconnect: ${error.message}`;
    if (!outputActive) {
      goLiveButton.textContent = 'Connect Stream';
      goLiveButton.disabled = false;
    }
  } finally {
    applyingStreamSettings = false;
    applyLiveSettingsButton.disabled = false;
    goLiveButton.disabled = false;
  }
});

goLiveButton.addEventListener('click', async () => {
  facebookPublishRequested = true;
  renderDestinationCards();
  if (applyingStreamSettings) return;
  const remaining = destinations.filter(d => destinationState(d.id) === 'offline');
  if (!remaining.length && outputActive) {
    if (!(await confirmAction('Disconnect every streaming destination?', 'Disconnect all'))) return;
    try { await stopLiveStream(); }
    catch (error) { streamStatusDetail.textContent = error.message; }
    return;
  }
  let config;
  try { config = await checkLiveReadiness(); }
  catch (error) { streamStatusDetail.textContent = error.message; return; }
  if (!(await confirmAction('Connect all remaining destinations? Facebook will need you to press Go Live after its preview is ready.', 'Connect all'))) return;
  goLiveButton.disabled = true;
  try {
    currentOutputConfig = { ...currentOutputConfig, ...(config.output || {}) };
    if (!outputActive) { applySceneChangesLive(); outputActive = true; }
    const ids = remaining.map(d => d.id);
    for (const id of ids) destinationStates.set(id, 'connecting');
    renderDestinationCards();
    await window.liturgiaStream.startOutput(ids);
    renderLiveDestinations();
  } catch (error) {
    streamStatusDetail.textContent = error.message;
    for (const d of remaining) destinationStates.set(d.id, 'offline');
    if (![...destinationStates.values()].some(s => s !== 'offline')) outputActive = false;
    renderDestinationCards();
  } finally { goLiveButton.disabled = false; }
});
window.liturgiaStream.onOutputStatus((status) => { void handleOutputStatus(status); });

window.addEventListener('beforeunload', () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
  audioStream?.getTracks().forEach((track) => track.stop());
  if (audioContext) audioContext.close();
  if (programSocket) programSocket.close();
  if (programFrame) programFrame.close();
});
requestAnimationFrame(drawPreview);
window.addEventListener('focus', () => { void refreshFacebookSessions(); });
setInterval(() => { if (destinations.some(isFacebookDestination)) void refreshFacebookSessions(); }, 60000);
refreshVideoDevices();
refreshAudioDevices();
loadStreamConfig();
loadEncoderInfo();

// Update controls deliberately mirror Worship's notice -> progress -> Run flow.
// Nothing installs automatically; the main process also rejects Run while streaming.
const updateUi = {
  anchor: document.querySelector('.update-anchor'),
  toggle: document.getElementById('update-toggle'),
  panel: document.getElementById('update-popover'),
  close: document.getElementById('update-close'),
  indicator: document.getElementById('update-indicator'),
  message: document.getElementById('update-message'),
  notes: document.getElementById('update-notes'),
  progress: document.getElementById('update-progress'),
  bar: document.getElementById('update-progress-bar'),
  percent: document.getElementById('update-percent'),
  safety: document.getElementById('update-safety'),
  check: document.getElementById('update-check'),
  release: document.getElementById('update-release'),
  download: document.getElementById('update-download'),
  run: document.getElementById('update-run')
};
let currentUpdateState = { phase: 'idle', supported: false };
let autoOpenedUpdateVersion = '';
function setUpdatePopoverOpen(open) {
  updateUi.panel.hidden = !open;
  updateUi.toggle.setAttribute('aria-expanded', String(open));
}
function renderUpdateStatus(status) {
  currentUpdateState = status;
  const phase = status.phase || 'idle';
  const version = status.latestVersion || '';
  const ready = phase === 'downloaded';
  if ((phase === 'available' || ready) && version && autoOpenedUpdateVersion !== version) {
    autoOpenedUpdateVersion = version;
    setUpdatePopoverOpen(true);
  }
  updateUi.indicator.hidden = !(phase === 'available' || phase === 'downloading' || ready);
  updateUi.indicator.classList.toggle('ready', ready);
  updateUi.toggle.title = ready ? `Update ${version} ready to install` : phase === 'available' ? `Update ${version} available` : 'Check for updates';
  const messages = {
    idle: `Installed version ${status.currentVersion}.`,
    checking: 'Checking GitHub for updates…',
    available: `Update ${version} is available (installed ${status.currentVersion}).`,
    current: `Liturgia Stream ${status.currentVersion} is up to date.`,
    downloading: `Downloading update ${version}…`,
    downloaded: `Update ${version} downloaded and ready to install.`,
    unsupported: 'Automatic updates are available in installed builds (Windows, macOS, or Linux AppImage).',
    error: `Update check failed: ${status.error || 'Unknown error'}`
  };
  updateUi.message.textContent = messages[phase] || messages.idle;
  updateUi.notes.hidden = !status.releaseNotes || !['available', 'downloading', 'downloaded'].includes(phase);
  updateUi.notes.textContent = (status.releaseNotes || '').replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  updateUi.progress.hidden = !['downloading', 'downloaded'].includes(phase);
  const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
  updateUi.bar.style.width = `${percent}%`;
  updateUi.percent.textContent = `${Math.round(percent)}%`;
  updateUi.check.disabled = phase === 'checking' || phase === 'downloading';
  updateUi.release.hidden = !['available', 'downloading', 'downloaded'].includes(phase);
  updateUi.download.hidden = phase !== 'available';
  updateUi.download.disabled = phase !== 'available';
  updateUi.run.hidden = !ready;
  updateUi.run.disabled = !ready || outputActive;
  updateUi.safety.hidden = !ready || !outputActive;
}
updateUi.toggle.addEventListener('click', () => setUpdatePopoverOpen(updateUi.panel.hidden));
updateUi.close.addEventListener('click', () => setUpdatePopoverOpen(false));
document.addEventListener('pointerdown', (event) => {
  if (!updateUi.panel.hidden && !updateUi.anchor.contains(event.target)) setUpdatePopoverOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !updateUi.panel.hidden) setUpdatePopoverOpen(false);
});
updateUi.check.addEventListener('click', async () => {
  try { renderUpdateStatus(await window.liturgiaStream.checkForUpdates()); }
  catch (error) { updateUi.message.textContent = `Could not check for updates: ${error.message}`; }
});
updateUi.release.addEventListener('click', async () => {
  try { await window.liturgiaStream.openReleasePage(); }
  catch (error) { updateUi.message.textContent = error.message; }
});
updateUi.download.addEventListener('click', async () => {
  updateUi.download.disabled = true;
  try {
    const result = await window.liturgiaStream.downloadUpdate();
    if (!result.ok) updateUi.message.textContent = result.error;
  } catch (error) { updateUi.message.textContent = error.message; }
});
updateUi.run.addEventListener('click', async () => {
  if (outputActive) return;
  updateUi.run.disabled = true;
  try {
    const result = await window.liturgiaStream.runUpdate();
    if (!result.ok) updateUi.message.textContent = result.error;
  } catch (error) { updateUi.message.textContent = error.message; }
  finally { updateUi.run.disabled = outputActive || currentUpdateState.phase !== 'downloaded'; }
});
window.liturgiaStream.onUpdateStatus(renderUpdateStatus);
window.liturgiaStream.getUpdateStatus().then(renderUpdateStatus).catch((error) => {
  updateUi.message.textContent = `Could not load update status: ${error.message}`;
});
