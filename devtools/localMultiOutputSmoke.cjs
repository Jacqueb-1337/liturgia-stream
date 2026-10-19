'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const {MultiOutputManager}=require('../multiOutputManager');
(async()=>{
 const dir=os.tmpdir(),input=path.join(dir,'liturgia-multi-smoke-input.webm');
 const a=path.join(dir,'liturgia-multi-smoke-a.flv'),b=path.join(dir,'liturgia-multi-smoke-b.flv');
 for(const x of [input,a,b])try{fs.unlinkSync(x)}catch(_){}
 const prep=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=15','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','7','-c:v','libvpx','-deadline','realtime','-cpu-used','6','-b:v','500k','-c:a','libopus','-y',input],{timeout:40000});
 if(prep.status!==0)throw Error('WebM synthetic input failed: '+String(prep.stderr).slice(-600));
 const manager=new MultiOutputManager();
 const result=[];
 manager.on('status',s=>{if(s.sourceId&&['live','reconnecting'].includes(s.state))result.push(s.sourceId+':'+s.state+(s.error?':'+s.error.slice(-160):''))});
 await manager.start({runtime:{available:true,executablePath:'ffmpeg',encoder:{id:'libx264'},supported:[{id:'libx264'}]},output:{width:640,height:360,fps:15,videoBitrateKbps:650,audioBitrateKbps:96,audioSampleRate:48000},destinations:[{id:'a',name:'A',outputUrl:a},{id:'b',name:'B',outputUrl:b}]});
 const data=fs.readFileSync(input);
 for(let at=0;at<data.length;at+=10000){
   await manager.writeChunk(data.subarray(at,Math.min(at+10000,data.length)));
   await new Promise(res=>setTimeout(res,35));
 }
 await new Promise(res=>setTimeout(res,3500));
 await manager.stop();
 console.log('RESULT='+JSON.stringify({statuses:result,files:[a,b].map(f=>({name:path.basename(f),size:fs.existsSync(f)?fs.statSync(f).size:0}))}));
 for(const f of [a,b]) {
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','csv=p=0',f],{encoding:'utf8',timeout:15000});
  console.log('CODECS '+path.basename(f)+' '+probe.stdout.trim()+' EXIT='+probe.status);
 }
 try{fs.unlinkSync(input)}catch(_){}
})().catch(e=>{console.error('SMOKE_ERROR='+e.message);process.exitCode=1});
