const fs=require('fs'),os=require('os'),path=require('path');
const {createSettingsStore}=require('../settingsStore');
const secure={
  isEncryptionAvailable:()=>true,
  encryptString:v=>Buffer.from('sealed:'+v,'utf8'),
  decryptString:v=>{
    const s=v.toString('utf8');
    if(!s.startsWith('sealed:'))throw Error('Invalid key');
    return s.slice(7);
  }
};
let dir,store;
beforeEach(async()=>{dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'liturgia-destinations-'));store=createSettingsStore(dir,secure)});
afterEach(async()=>fs.promises.rm(dir,{recursive:true,force:true}));

test('migrates an existing single encrypted destination without changing its key',async()=>{
  await store.save({destination:{name:'Original Facebook',server:'rtmps://live-api-s.facebook.com/rtmp/',streamKey:'not-a-real-fb-secret'}});
  const before=JSON.parse(await fs.promises.readFile(path.join(dir,'settings.json'),'utf8')).destination.encryptedKey;
  expect((await store.load()).destinations).toMatchObject([{id:'legacy-primary',name:'Original Facebook',keySaved:true}]);
  await store.saveDestination({id:'legacy-primary',name:'Facebook Live',server:'rtmps://rtmp-api.facebook.com/rtmp/',streamKey:''});
  const raw=JSON.parse(await fs.promises.readFile(path.join(dir,'settings.json'),'utf8'));
  expect(raw.destinations[0].encryptedKey).toBe(before);
  expect((await store.getDestinationCredentialsByIds(['legacy-primary']))[0].streamKey).toBe('not-a-real-fb-secret');
});

test('adds independently encrypted targets and deletes only the selected one',async()=>{
  const x=await store.saveDestination({name:'YouTube',server:'rtmps://example.test/live',streamKey:'youtube-secret'});
  const y=await store.saveDestination({name:'Facebook',server:'rtmps://example.org/live',streamKey:'facebook-secret'});
  const raw=await fs.promises.readFile(path.join(dir,'settings.json'),'utf8');
  expect(raw).not.toContain('youtube-secret');
  expect(raw).not.toContain('facebook-secret');
  expect((await store.load()).destinations.map(d=>d.id)).toEqual([x.id,y.id]);
  await store.deleteDestination(x.id);
  expect((await store.load()).destinations.map(d=>d.id)).toEqual([y.id]);
  expect((await store.getDestinationCredentialsByIds([y.id]))[0].streamKey).toBe('facebook-secret');
});

test('rejects missing keys and invalid destination URLs',async()=>{
  await expect(store.saveDestination({name:'Empty',server:'rtmps://example.test/live',streamKey:''})).rejects.toThrow('Enter a stream key');
  await expect(store.saveDestination({name:'Bad',server:'file:///etc/passwd',streamKey:'foo'})).rejects.toThrow('RTMP');
  await expect(store.saveDestination({name:'Query',server:'rtmps://example.test/live?key=one',streamKey:'foo'})).rejects.toThrow('query parameters');
});


test('Camera + Liturgia inherits the full saved Custom Scene 1 canvas and text styling',async()=>{
  const camera={id:'camera-original',type:'camera',name:'Camera',x:0,y:0,width:1920,height:1080,
    cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,panX:0,panY:0,zoom:1,opacity:1,visible:true};
  const words={id:'words-original',type:'program',name:'Liturgia Program',x:0,y:0,width:1920,height:1080,
    transparent:true,visible:true,sourceStyles:{verseText:'color: #ffffff; font-family: Verdana; shadow-color: #000000; shadow-blur: 30; stroke-color: #000000; stroke-width: 2;'}};
  await store.saveScenes([
    {id:'camera-program',name:'Camera + Liturgia',cameraVisible:true,programVisible:true},
    {id:'custom-1',name:'Custom Scene 1',custom:true,layers:[camera,words]}
  ],'custom-1');
  const config=await store.load();
  const builtin=config.scenes[0],original=config.scenes[1];
  expect(builtin.custom).toBe(true);
  expect(builtin.layers.map(l=>l.type)).toEqual(['camera','program']);
  expect(builtin.layers[0]).toMatchObject({x:0,y:0,width:1920,height:1080});
  expect(builtin.layers[1]).toMatchObject({x:0,y:0,width:1920,height:1080,transparent:true});
  expect(builtin.layers[1].sourceStyles).toEqual(original.layers[1].sourceStyles);
  expect(builtin.layers[1].id).not.toBe(original.layers[1].id);
  builtin.layers[1].sourceStyles.verseText='changed';
  expect(original.layers[1].sourceStyles.verseText).toContain('Verdana');
});

test('reusable Worship profile linkage survives Stream scene reload',async()=>{
  const profileId='a0d5af44-1423-4e47-bebf-bcd193d6f22e';
  const scene={id:'my-scene',name:'My Scene',custom:true,
    layers:[{id:'program-1',type:'program',name:'Liturgia Program',
      x:0,y:700,width:1920,height:350,transparent:true,
      worshipProfileId:profileId,worshipProfileRevision:7,
      sourceStyles:{global:'safe-area-y: 0.7;'} }]};
  await store.saveScenes([scene],'my-scene');
  const reloaded=await store.load();
  const layer=reloaded.scenes[0].layers[0];
  expect(layer).toMatchObject({worshipProfileId:profileId,worshipProfileRevision:7,
    x:0,y:700,width:1920,height:350,transparent:true});
  expect(layer.sourceStyles.global).toContain('0.7');
});

test('Program disconnect behavior and placeholder text survive restart',async()=>{
  const scene={id:'offline-demo',name:'Offline Scene',custom:true,layers:[{
    id:'program-1',type:'program',name:'Worship Program',visible:true,
    offlineMode:'preserve',offlineText:'Waiting for Worship'
  }]};
  await store.saveScenes([scene],'offline-demo');
  const after=await store.load();
  expect(after.scenes[0].layers[0]).toMatchObject({
    offlineMode:'preserve',offlineText:'Waiting for Worship'
  });
});

test('saving shared output quality does not alter destination credentials',async()=>{
  const x=await store.saveDestination({name:'Twitch',server:'rtmps://example.test/app',streamKey:'topsecret'});
  const before=JSON.parse(await fs.promises.readFile(path.join(dir,'settings.json'),'utf8')).destinations[0].encryptedKey;
  await store.saveOutput({width:1280,height:720,fps:30,videoBitrateKbps:2500,audioBitrateKbps:128});
  expect((await store.load()).output.videoBitrateKbps).toBe(2500);
  const after=JSON.parse(await fs.promises.readFile(path.join(dir,'settings.json'),'utf8')).destinations[0].encryptedKey;
  expect(after).toBe(before);
  expect((await store.getDestinationCredentialsByIds([x.id]))[0].streamKey).toBe('topsecret');
});
