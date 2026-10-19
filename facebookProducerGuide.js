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
    const msg = keyHelp ? 'Facebook connection is still pending. Choose how to continue.' : 'Connecting Liturgia Stream to Facebook…';
    // Preserve an in-progress pasted key instead of rebuilding the form every poll.
    if (keyHelp && overlay.querySelector('input[aria-label="New Facebook stream key"]')) return;
    overlay.replaceChildren();
    const panel=document.createElement('div'); panel.className='panel';
    const title=document.createElement('div'); title.textContent=msg; panel.append(title);
    const note=document.createElement('small'); note.textContent=keyHelp ? 'Check the preview and video-input status. You can retry with the page’s stream key, paste another key, or cancel this Facebook connection without affecting other destinations.' : 'Selecting Streaming software and waiting for the RTMPS connection. Other destinations remain active.';panel.append(note);
    if (keyHelp) {
      const actions=document.createElement('div'); actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:15px;justify-content:center';
      const pasted=document.createElement('input'); pasted.type='password';pasted.autocomplete='off';pasted.placeholder='Paste a different stream key';pasted.setAttribute('aria-label','New Facebook stream key');
      pasted.style.cssText='padding:11px;border-radius:7px;border:1px solid #7090ae;background:#091923;color:#fff;width:100%;box-sizing:border-box';
      const action=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await handler();keyHelp=false;startedSelectingAt=Date.now();}catch(e){note.textContent=e.message||'Could not update connection';}finally{b.disabled=false;}});actions.append(b);};
      const locatePageKey=()=>{
        const candidates=[...document.querySelectorAll('input')].filter(el=>el!==pasted && el.closest('#liturgia-assistant')===null);
        for (const el of candidates) {
          const vicinity=[el.getAttribute('aria-label'),el.getAttribute('placeholder'),el.id,el.closest('label')?.textContent,el.parentElement?.parentElement?.textContent?.slice(0,140)].join(' ');
          if (/stream\s*key/i.test(vicinity) && el.value && el.value.length>=12) return el.value;
        }
        throw new Error('Cannot safely identify the stream key field on this Facebook page. Paste it below instead.');
      };
      panel.append(pasted);
      action('Use key from this page',()=>window.liturgiaProducer.useStreamKey(locatePageKey()));
      action('Use pasted key',()=>window.liturgiaProducer.useStreamKey(pasted.value));
      action('Cancel Facebook connection',async()=>{await window.liturgiaProducer.cancelConnection();overlay.remove();window.close();});
      panel.append(actions);
    }
    overlay.append(panel);
  }
  window.__liturgiaGuide={ setState(data) { mode=data.mode||mode; connected=!!data.connected; if(connected)keyHelp=false;render(); }, tick:render };
  setInterval(render,1500);
  render();
}

module.exports = { installProducerGuide };
