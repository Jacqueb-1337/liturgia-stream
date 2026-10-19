'use strict';

// Executed only inside the isolated Facebook Producer BrowserWindow.
function installProducerGuide() {
  if (window.__liturgiaGuide) return;
  const style = document.createElement('style');
  style.textContent = `@keyframes liturgiaPulse { 0%,100% { outline:4px solid #ffce52; box-shadow:0 0 10px 4px #ffcb4c88 } 50% { outline:5px solid #fff4b0; box-shadow:0 0 25px 13px #ffce5288 } }
  .liturgia-target { animation:liturgiaPulse 1.15s ease-in-out infinite!important; outline-offset:3px!important; position:relative!important; z-index:2147483646!important }
  #liturgia-assistant { position:fixed!important; inset:0!important; z-index:2147483640!important; background:#030914a8!important; display:flex!important; flex-direction:column!important; align-items:center!important; justify-content:center!important; gap:14px!important; color:white!important; font:600 18px system-ui!important; text-align:center!important; pointer-events:none!important }
  #liturgia-assistant .panel { max-width:540px; background:#142536; border:1px solid #5b7d9a; border-radius:14px; padding:26px; box-shadow:0 15px 35px #0008; pointer-events:auto; }
  #liturgia-assistant button { border-radius:8px; background:#2775c2; color:white; padding:10px 16px; border:0; cursor:pointer; font:600 14px system-ui; }
  #liturgia-assistant small {display:block;color:#c2cad6;font-size:13px;margin-top:10px}`;
  document.head.append(style);
  let mode = 'connect';
  let connected = false;
  let startedSelectingAt = 0;
  let keyHelp = false;
  const interactive = () => [...document.querySelectorAll('button,[role="button"],[role="radio"],label,a')];
  const name = el => (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const target = (re) => interactive().find(el => visible(el) && re.test(name(el)) && name(el).length < 110);
  function render() {
    document.querySelectorAll('.liturgia-target').forEach(el=>el.classList.remove('liturgia-target'));
    let overlay = document.getElementById('liturgia-assistant');
    if (!overlay) { overlay = document.createElement('div'); overlay.id='liturgia-assistant'; document.body?.append(overlay); }
    if (!overlay) return;
    const setup = target(/^set up live video$/i);
    const software = target(/^streaming software$/i);
    const selected = software?.getAttribute('aria-checked') === 'true' || software?.getAttribute('aria-selected') === 'true';
    const copy = target(/^(copy stream key|copy key)$/i) || document.querySelector('[aria-label="Copy stream key"]');
    // Exclude the similarly named progress/navigation step, which is not a publish control.
    const publish = interactive().find(el => visible(el) && /^(go live|start live video)$/i.test(name(el)) && !el.hasAttribute('aria-current') && !el.closest('[role="navigation"]') && !el.closest('#liturgia-assistant'));
    if (connected && mode === 'publish') {
      overlay.remove();
      if (publish) { publish.classList.add('liturgia-target'); publish.scrollIntoView({block:'center',behavior:'smooth'}); }
      return;
    }
    if (selected && !startedSelectingAt) startedSelectingAt = Date.now();
    if (!connected && selected && Date.now()-startedSelectingAt > 20000) keyHelp = true;
    if (setup) { setup.classList.add('liturgia-target'); if (Date.now() - Number(setup.dataset.liturgiaClicked||0) > 3500) { setup.dataset.liturgiaClicked=String(Date.now()); setup.click(); } }
    else if (software && !selected) { software.classList.add('liturgia-target'); if (Date.now() - Number(software.dataset.liturgiaClicked||0) > 3500) { software.dataset.liturgiaClicked=String(Date.now()); software.click(); } }
    if (keyHelp && copy) { copy.classList.add('liturgia-target'); copy.scrollIntoView({block:'center',behavior:'smooth'}); }
    const msg = keyHelp ? 'Facebook has not accepted the stream. Check the stream key and copy it again.' : 'Connecting Liturgia Stream to Facebook…';
    overlay.replaceChildren();
    const panel=document.createElement('div'); panel.className='panel';
    const title=document.createElement('div'); title.textContent=msg; panel.append(title);
    const note=document.createElement('small'); note.textContent=keyHelp ? 'Use Facebook’s highlighted Copy stream key button, then choose Use copied key. Connection will retry without affecting other destinations.' : 'Selecting Streaming software and waiting for the RTMPS connection. Other destinations remain active.';panel.append(note);
    if (keyHelp) { const button=document.createElement('button');button.textContent='Use copied stream key';button.style.marginTop='15px';button.onclick=async()=>{button.disabled=true;try{await window.liturgiaProducer.useCopiedKey();keyHelp=false;startedSelectingAt=Date.now();}catch(e){note.textContent=e.message||'Could not update stream key';}finally{button.disabled=false;}};panel.append(button); }
    overlay.append(panel);
  }
  window.__liturgiaGuide={ setState(data) { mode=data.mode||mode; connected=!!data.connected; if(connected)keyHelp=false;render(); }, tick:render };
  setInterval(render,1500);
  render();
}

module.exports = { installProducerGuide };
