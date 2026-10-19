(function(global){
  function alignCoordinate(value,size,anchors,threshold=12) {
    const candidates=[value,value+size/2,value+size];
    let best={delta:0,distance:Infinity,guide:null};
    for(const target of anchors)for(const source of candidates){
      const distance=Math.abs(target-source);
      if(distance<best.distance && distance<=threshold)best={delta:target-source,distance,guide:target};
    }
    return best;
  }
  function snapBounds(bounds,scene,mode) {
    if(mode==='grid') {
      // A 16:9 ratio-preserving grid: 12 columns by 12 rows, i.e. 160x90.
      const x=Math.round((bounds.x+bounds.width/2)/160)*160-bounds.width/2;
      const y=Math.round((bounds.y+bounds.height/2)/90)*90-bounds.height/2;
      return {...bounds,x,y,guideX:x+bounds.width/2,guideY:y+bounds.height/2};
    }
    if(mode!=='align')return bounds;
    const ax=[0,960,1920],ay=[0,540,1080];
    for(const layer of scene.layers||[]){
      if(layer.id===bounds.id || !layer.visible)continue;
      ax.push(layer.x,layer.x+layer.width/2,layer.x+layer.width);
      ay.push(layer.y,layer.y+layer.height/2,layer.y+layer.height);
    }
    const x=alignCoordinate(bounds.x,bounds.width,ax);
    const y=alignCoordinate(bounds.y,bounds.height,ay);
    return {...bounds,x:bounds.x+x.delta,y:bounds.y+y.delta,guideX:x.guide,guideY:y.guide};
  }
  global.liturgiaSnap={snapBounds,alignCoordinate};
  if(typeof module!=='undefined')module.exports={snapBounds,alignCoordinate};
})(typeof window!=='undefined'?window:globalThis);
