const {EventEmitter}=require('events');
const {MultiOutputManager}=require('../multiOutputManager');
function child(){const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=Object.assign(new EventEmitter(),{writable:true,destroyed:false,writableLength:0,write:jest.fn(()=>true),destroy:jest.fn(),end:jest.fn()});c.kill=jest.fn(()=>c.emit('close',1));return c;}
const runtime={available:true,executablePath:'ffmpeg',supported:[{id:'libx264',label:'H.264'}],encoder:{id:'libx264'}};
const destinations=[{id:'youtube',name:'YouTube',outputUrl:'rtmps://youtube.invalid/live/key'},{id:'facebook',name:'Facebook',outputUrl:'rtmps://facebook.invalid/rtmp/key'}];
test('Facebook publisher can fail and retry while YouTube and the shared encoder stay live',async()=>{
  const children=[];const timers=[];const updates=[];
  const manager=new MultiOutputManager({spawnProcess:()=>{const c=child();children.push(c);return c;},setTimeout:(fn)=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
  manager.on('status',s=>updates.push(s));
  await manager.start({runtime,output:{width:1280,height:720,fps:30,videoBitrateKbps:2000,audioBitrateKbps:128,audioSampleRate:48000},destinations});
  expect(children).toHaveLength(3);
  const [encoder,youtube,facebook]=children;
  youtube.stderr.emit('data','frame=12\n');
  expect(manager.snapshot().sources.find(s=>s.id==='youtube').state).toBe('live');
  facebook.stderr.emit('data','Error opening output: End of file\n');
  facebook.emit('close',1);
  expect(manager.snapshot().sources.find(s=>s.id==='facebook').state).toBe('reconnecting');
  expect(manager.snapshot().sources.find(s=>s.id==='youtube').state).toBe('live');
  const packet=Buffer.from('mpegts');encoder.stdout.emit('data',packet);
  expect(youtube.stdin.write).toHaveBeenCalledWith(packet);
  expect(encoder.kill).not.toHaveBeenCalled();
  expect(updates.some(s=>s.sourceId==='facebook'&&s.state==='reconnecting')).toBe(true);
  timers[0]();
  expect(children).toHaveLength(4);
  expect(encoder.kill).not.toHaveBeenCalled();
  await manager.stop();
});
