const {EventEmitter}=require('events');
const {MultiOutputManager,buildSharedEncoderArgs,buildPublisherArgs,sanitize}=require('../multiOutputManager');

function fakeProcess() {
  const child=new EventEmitter();
  child.stdout=new EventEmitter();
  child.stderr=new EventEmitter();
  child.stdin=Object.assign(new EventEmitter(), {
    writable:true,destroyed:false,writableLength:0,
    write:jest.fn((_chunk,callback)=>{if(callback)callback();return true}),
    destroy:jest.fn(function(){this.destroyed=true;this.writable=false}),
    end:jest.fn()
  });
  child.kill=jest.fn(()=>child.emit('close',1));
  return child;
}
const config=(destinations)=>({
  runtime:{available:true,executablePath:'ffmpeg',supported:[{id:'libx264',label:'H.264'}],encoder:{id:'libx264'}},
  output:{width:1280,height:720,fps:30,videoBitrateKbps:2100,audioBitrateKbps:128,audioSampleRate:48000},
  destinations
});
const one={id:'facebook',name:'Facebook',outputUrl:'rtmps://example.invalid/rtmp/key1'};
const two={id:'youtube',name:'YouTube',outputUrl:'rtmps://example.invalid/live/key2'};

describe('shared local encoder with independent RTMP publishers',()=>{
  test('only one encode is used when adding a second destination',async()=>{
    const spawned=[];
    const manager=new MultiOutputManager({spawnProcess:jest.fn(()=>{const c=fakeProcess();spawned.push(c);return c})});
    await manager.start(config([one]));
    expect(spawned).toHaveLength(2);
    await manager.start(config([two]));
    expect(spawned).toHaveLength(3);
    expect(spawned[0].stdout).toBeDefined();
    const packet=Buffer.from('mpeg-ts-packet');
    spawned[0].stdout.emit('data',packet);
    expect(spawned[1].stdin.write).toHaveBeenCalledWith(packet);
    expect(spawned[2].stdin.write).toHaveBeenCalledWith(packet);
    expect(manager.snapshot().sources.map(s=>s.id)).toEqual(['facebook','youtube']);
    await manager.stop('facebook');
    expect(manager.snapshot().sources.map(s=>s.id)).toEqual(['youtube']);
    expect(spawned[0].kill).not.toHaveBeenCalled();
    await manager.stop();
    expect(manager.state).toBe('stopped');
  });

  test('never sends stale headerless WebM data to a restarted encoder',async()=>{
    const children=[];
    let retry;
    const manager=new MultiOutputManager({
      spawnProcess:()=>{const c=fakeProcess();children.push(c);return c},
      setTimeout:(cb)=>{retry=cb;return 1},clearTimeout:jest.fn()
    });
    await manager.start(config([one]));
    expect(await manager.writeChunk(Buffer.from('late-media-data'))).toBe(false);
    const header=Buffer.from('1a45dfa30001','hex');
    expect(await manager.writeChunk(header)).toBe(true);
    children[0].emit('close',1);
    expect(manager.state).toBe('reconnecting');
    retry();
    expect(await manager.writeChunk(Buffer.from('old-data'))).toBe(false);
    expect(await manager.writeChunk(header)).toBe(true);
    await manager.stop();
  });

  test('uses MPEGTS only between encoder and copy-only publishers',()=>{
    const args=buildSharedEncoderArgs(config([]).output,'libx264');
    expect(args.slice(-1)).toEqual(['pipe:1']);
    expect(args.slice(-7)).toEqual(['-mpegts_flags','+resend_headers','-muxdelay','0','-f','mpegts','pipe:1']);
    expect(args.lastIndexOf('-f')).toBe(args.indexOf('mpegts') - 1);
    const dest=buildPublisherArgs(one.outputUrl);
    expect(dest).toContain('copy');
    expect(dest).toContain('pipe:0');
    expect(dest.at(-1)).toBe(one.outputUrl);
  });

  test('hides stream destination credentials in errors',()=>{
    expect(sanitize('I/O error rtmps://example.com/rtmp/FB-secret')).not.toContain('FB-secret');
  });
});
