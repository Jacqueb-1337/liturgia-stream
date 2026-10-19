const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const code=p=>fs.readFileSync(path.join(root,p),'utf8');
const {snapBounds}=require('../snapLayout');
describe('scene editor snapping',()=>{
 test('shift grid preserves 16:9 cells and centers any-sized source exactly',()=>{
   const result=snapBounds({id:'t',x:902,y:490,width:240,height:100},{layers:[]},'grid');
   expect(result.x+120).toBe(960);
   expect(result.y+50).toBe(540);
   expect(result.guideX).toBe(960);
   expect(result.guideY).toBe(540);
 });
 test('ctrl aligns centers and edges of nearby source',()=>{
   const scene={layers:[{id:'other',visible:true,x:270,y:320,width:300,height:180}]};
   const result=snapBounds({id:'current',x:576,y:325,width:100,height:80},scene,'align');
   expect(result.x).toBe(570);
   expect(result.y).toBe(320);
 });
 test('ordinary drag remains unsnapped',()=>{
   const pos={x:123,y:159,width:340,height:160,id:'a'};
   expect(snapBounds(pos,{layers:[]},null)).toBe(pos);
 });
});
describe('Worship Program and Widget layer separation',()=>{
 const renderer=code('renderer.js'),html=code('index.html'),settings=code('settingsStore.js');
 test('widget frames use separate widget-only receiver',()=>{
   expect(html).toContain('<option value="widgets">Worship Widgets</option>');
   expect(renderer).toContain("options.set('widgetOnly','1')");
   expect(renderer).toContain("layer.type === 'widgets'");
   expect(settings).toContain("'widgets'");
 });
 test('offline renderer supports blank, placeholder, saved frame with disk persistence',()=>{
   expect(html).toContain('value="none">Show nothing');
   expect(html).toContain('value="preserve"');
   expect(html).toContain('value="placeholder"');
   expect(renderer).toContain("layer.offlineMode==='placeholder'");
   expect(renderer).toContain("layer.offlineMode==='preserve'");
   expect(renderer).toContain('loadOfflineProgramFrame');
   expect(renderer).toContain('saveOfflineProgramFrame');
   expect(code('main.js')).toContain('offline-program-frames');
   expect(settings).toContain("offlineMode:");
 });
 test('updates surface automatically',()=>{
   expect(renderer).toContain('setUpdatePopoverOpen(true)');
   expect(code('main.js')).toContain('void updateService.check();');
 });
});
