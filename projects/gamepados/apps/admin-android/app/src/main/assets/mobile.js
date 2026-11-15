(function () {
  if (window.__gposMobileInstalled) return;
  window.__gposMobileInstalled = true;
  const style = document.createElement('style');
  style.textContent = `
    html,body { overscroll-behavior-y:contain; }
    .app { height:100dvh !important; min-height:0 !important; }
    @media(max-width:900px) {
      .main,.view,.list-pane,.detail-pane { min-width:0; min-height:0; }
      .side { flex-shrink:0; max-width:100vw; }
      .app { padding-bottom:66px; position:relative; }
      .side { display:none !important; }
      body.mobile-menu-open .side { display:flex !important; position:fixed; inset:0 0 66px 0; z-index:900; width:100%; flex-direction:column; align-items:stretch; padding:24px 20px; overflow-y:auto; background:var(--bg); }
      body.mobile-menu-open .side .brand { padding:0 0 20px; }
      body.mobile-menu-open .brand-txt { display:block; }
      body.mobile-menu-open .nav { display:grid; grid-template-columns:1fr 1fr; gap:12px; flex-shrink:0; }
      body.mobile-menu-open .nav-item { white-space:normal; width:100%; min-height:72px; padding:14px; border:1px solid var(--border); background:var(--panel); flex-direction:column; align-items:flex-start; gap:10px; }
      body.mobile-menu-open .side-foot { margin:24px 0 0; padding-top:20px; border-top:1px solid var(--border); flex-direction:column; align-items:stretch; gap:16px; }
      body.mobile-menu-open .me-name { max-width:none; }
      /* Bottom menu: dark + white like the app's sign-in screen and top bar (owner, 2026-11-15: not indigo). */
      .mobile-bottom-nav { display:flex !important; position:fixed; bottom:0; left:0; right:0; height:66px; background:#0b0b0c; border-top:1px solid #2c2c30; z-index:901; padding:6px 8px; gap:4px; }
      .mobile-bottom-nav button { flex:1; border:0; border-radius:14px; background:transparent; color:#a1a1a6; font:500 12px var(--fb); min-height:52px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; transition:background .18s ease,color .18s ease; }
      .mobile-bottom-nav button svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .mobile-bottom-nav button[aria-current=page],.mobile-bottom-nav button[aria-expanded=true] { background:#1c1c1f; color:#ffffff; }
      .list-head { padding:16px 16px 8px; }
      .tabs { overflow-x:auto; flex-wrap:nowrap; gap:6px; padding:8px 0; }
      .tab { flex-shrink:0; white-space:nowrap; }
      .list-sub { padding:8px 16px 12px; }
      .list-scroll { padding-bottom:16px; }
      .ov-scroll { padding:20px 16px; }
      .detail-scroll { padding:16px 16px 24px; }
      .overlay { z-index:1000 !important; }
      .modal { border-radius:20px 20px 0 0; padding:20px 16px 28px; }
      .nav-item,.mini-btn,.back-btn,.tab,.scope button { min-height:44px; }
      .list-scroll,.detail-scroll,.ov-scroll { -webkit-overflow-scrolling:touch; }
      .modal { max-height:92dvh; overflow-y:auto; overflow-x:hidden; }
      .modal input,.modal select,.modal textarea,.search,.reply-box { font-size:16px !important; }
      .modal .frow { flex-wrap:wrap; }
      .modal table { display:block; overflow-x:auto; max-width:100%; }
      .ql-toolbar { display:flex; flex-wrap:wrap; }
      .ql-toolbar button { min-height:36px; min-width:36px; }
      .reply-actions { flex-wrap:wrap; }
      img,video { max-width:100%; }
    }
    @media(max-width:380px) { .stats-wrap,.ov-grid { grid-template-columns:1fr !important; } }
  `;
  document.head.appendChild(style);
  const side = document.querySelector?.('.side');
  if (side) {
    const dock = document.createElement('nav');
    dock.className = 'mobile-bottom-nav'; dock.style.display = 'none';
    dock.setAttribute('aria-label', 'Main navigation');
    // Line icons (24-unit grid), drawn with the text colour so the selected tab turns white.
    const ICON = {
      inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>',
      overview: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
      releases: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
      menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    };
    const icon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
    const destinations = [['inbox','Inbox'],['overview','Overview'],['releases','Releases']];
    function renderDock() {
      dock.replaceChildren();
      for (const [id,label] of destinations) {
        const target = document.getElementById('nav-' + id);
        if (!target) continue;
        const button = document.createElement('button');
        button.innerHTML = icon(id) + label;
        if (target.classList.contains('active') && !document.body.classList.contains('mobile-menu-open')) button.setAttribute('aria-current','page');
        button.onclick = () => { document.body.classList.remove('mobile-menu-open'); target.click(); renderDock(); };
        dock.appendChild(button);
      }
      const more = document.createElement('button'); more.innerHTML=icon('menu')+'Menu';
      more.setAttribute('aria-expanded',String(document.body.classList.contains('mobile-menu-open')));
      more.onclick=()=>{document.body.classList.toggle('mobile-menu-open');renderDock();};dock.appendChild(more);
    }
    document.body.appendChild(dock);
    side.addEventListener('click', e => { if (e.target.closest('.nav-item,.mini-btn')) {document.body.classList.remove('mobile-menu-open');setTimeout(renderDock,0);} });
    new MutationObserver(renderDock).observe(document.getElementById('nav'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    window.closeMobileMenu=()=>{if(!document.body.classList.contains('mobile-menu-open'))return false;document.body.classList.remove('mobile-menu-open');renderDock();return true;};
    renderDock();
  }
  const form = window.uiForm;
  if (typeof form === 'function') window.uiForm = function (options) {
    if (!(options.fields || []).some(f => f.name === 'releaseKey')) return form(options);
    return form({ ...options,
      intro: (options.intro || '') + '<p style="margin-top:12px;color:var(--muted)">Check the details, then approve with your fingerprint. (Face unlock opens the app, but only your fingerprint can publish a release.)</p>',
      fields: options.fields.filter(f => f.name !== 'releaseKey')
    });
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, options) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    if (url.origin !== location.origin || method !== 'POST' ||
        !/^\/api\/admin\/releases\/(register-activate|schedule|[^/?]+\/activate)$/.test(url.pathname))
      return originalFetch(input, options);
    if (url.search) throw new Error('Release URLs must not contain query parameters.');
    if (typeof options?.body !== 'string') throw new Error('Unsupported release request. Refresh the portal.');
    const body = JSON.stringify(JSON.parse(options.body));
    const approval = window.prompt('GPOS_APPROVE:' + JSON.stringify({path:url.pathname, body}));
    if (!approval) throw new Error('Release approval cancelled.');
    const headers = new Headers(options.headers || {});
    headers.set('x-mobile-approval', approval);
    return originalFetch(input, {...options, body, headers});
  };
})();

// Reflow dense desktop dialogs without replacing their controls or permission checks.
(function () {
  const modal = document.querySelector?.('#modalBox');
  if (!modal || !window.matchMedia('(max-width:900px)').matches) return;
  const css = document.createElement('style');
  css.textContent = `
    @media(max-width:900px) {
      .overlay.show { align-items:stretch !important; padding:0 !important; }
      #modalBox { width:100% !important; max-width:100% !important; height:100dvh; max-height:100dvh !important; border-radius:0 !important; padding:0 16px 28px !important; scroll-padding-top:80px; }
      #modalBox > h2 { position:sticky; top:0; z-index:5; background:var(--panel); margin:0 -16px 20px; padding:18px 16px; border-bottom:1px solid var(--border); font-size:20px; min-height:66px; }
      #modalBox .x { min-width:44px; min-height:44px; }
      #modalBox h3 { font-size:17px !important; line-height:1.45; flex-wrap:wrap; }
      #modalBox .mini,#modalBox .btn { min-height:44px; padding:10px 14px; font-size:14px; white-space:normal; }
      #modalBox input,#modalBox select,#modalBox textarea { min-height:46px; max-width:100%; min-width:0; }
      #modalBox .frow { flex-direction:column; align-items:stretch; gap:12px; }
      #modalBox .frow > * { width:100% !important; flex:auto !important; }
      #modalBox .phone-stack { flex-direction:column !important; align-items:stretch !important; gap:16px !important; }
      #modalBox .phone-grid { grid-template-columns:minmax(0,1fr) !important; gap:16px !important; }
      #modalBox .phone-cards { display:block; width:100%; overflow:visible; border:0; }
      #modalBox .phone-cards > tbody { display:block; }
      #modalBox .phone-cards tr { display:block; margin:0 0 16px; padding:16px; border:1px solid var(--border); border-radius:16px; background:var(--panel-2); }
      #modalBox .phone-cards tr.phone-table-head { display:none; }
      #modalBox .phone-cards td { display:block; width:auto !important; max-width:none !important; padding:8px 0 !important; border:0; white-space:normal !important; overflow:visible !important; text-overflow:clip !important; overflow-wrap:anywhere; font-size:14px !important; line-height:1.55; text-align:left !important; }
      #modalBox .phone-cards td::before { content:attr(data-label); display:block; color:var(--muted); font:600 11px var(--fb); letter-spacing:.06em; text-transform:uppercase; margin-bottom:5px; }
      #modalBox .phone-cards td[data-label=""]::before { display:none; }
      #modalBox .phone-cards td:first-child { padding-top:0 !important; font-size:16px !important; }
      #modalBox .phone-cards td > .mini { margin:4px 6px 4px 0; }
      #modalBox .lock-tag { display:inline-flex; width:fit-content; }
      #modalBox .phone-disclosure { border:1px solid var(--border); border-radius:14px; margin:16px 0; padding:0 14px 14px; }
      #modalBox .phone-disclosure > summary { cursor:pointer; padding:16px 0; font-size:16px; font-weight:600; line-height:1.5; }
      #modalBox .phone-disclosure:not([open]) { padding-bottom:0; }
      #modalBox .phone-cards td [title] { white-space:normal !important; max-width:100% !important; }
      #modalBox .phone-card-single { background:transparent !important; border:0 !important; padding:0 !important; }
      #modalBox .phone-section-tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; padding:5px; border-radius:14px; background:var(--panel-2); margin-bottom:20px; }
      #modalBox .phone-section-tabs button { min-height:46px; border:0; border-radius:10px; background:transparent; color:var(--muted); font:600 13px var(--fb); }
      #modalBox .phone-section-tabs button[aria-selected=true] { background:var(--panel); color:var(--indigo); box-shadow:var(--shadow-sm); }
      #modalBox .phone-release-section[hidden] { display:none !important; }
      #modalBox .phone-release-intro { font-size:14px; color:var(--muted); line-height:1.65; margin:0 0 18px; }
      #modalBox details.phone-help { margin:16px 0; color:var(--muted); font-size:14px; line-height:1.6; }
      #modalBox details.phone-help summary { padding:12px 0; cursor:pointer; font-weight:600; }
    }
  `;
  document.head.appendChild(css);
  let lastHeading=null;
  function organize() {
    observer.disconnect();
    try {
      const title = modal.querySelector('h2')?.textContent || '';
      if(lastHeading!==modal.querySelector('h2')) {lastHeading=modal.querySelector('h2');modal.scrollTop=0;}
      if (title.includes('Releases') && !modal.querySelector('.phone-section-tabs')) {
        const headings = [...modal.querySelectorAll('h3')];
        const android = headings.find(h=>h.textContent.includes('App Releases'));
        const windows = headings.find(h=>h.textContent.includes('PC Releases'));
        const stores = headings.find(h=>h.textContent.includes('Store versions'));
        if (android && windows) {
          const group=android.parentElement.parentElement;
          const schedule=headings.find(h=>h.textContent.includes('Scheduled releases'))?.parentElement.parentElement;
          const heading=modal.querySelector('h2');
          const intro=heading.nextElementSibling;
          if (intro && intro!==group && intro!==schedule) {
            const help=document.createElement('details');help.className='phone-help';
            const summary=document.createElement('summary');summary.textContent='How releases work';help.appendChild(summary);
            intro.replaceWith(help);help.appendChild(intro);
          }
          const tabs=document.createElement('div');tabs.className='phone-section-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Release sections');
          heading.after(tabs);
          const panels=[];
          for(const [i,label] of ['Builds','Schedule','Stores'].entries()) {
            const panel=document.createElement('section');panel.className='phone-release-section';panel.id='phone-release-'+i;panel.setAttribute('role','tabpanel');
            const button=document.createElement('button');button.textContent=label;button.id='phone-tab-'+i;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',button.id);
            button.onclick=()=>{panels.forEach((p,n)=>{p.panel.hidden=n!==i;p.button.setAttribute('aria-selected',String(n===i));});modal.scrollTop=0;};
            tabs.appendChild(button);panels.push({panel,button});modal.appendChild(panel);
          }
          panels[0].panel.appendChild(group);
          if(schedule)panels[1].panel.appendChild(schedule);else panels[1].panel.textContent='Scheduling is unavailable. Refresh to try again.';
          if(stores) { let node=stores;while(node && !node.classList.contains('phone-release-section')){const next=node.nextElementSibling;panels[2].panel.appendChild(node);node=next;} }
          else panels[2].panel.textContent='Store versions could not be loaded. Refresh to try again.';
          panels[0].button.click();
        }
      }
      if (/Billing|App control/.test(title)) {
        [...modal.children].filter(el=>el.tagName==='H3').forEach(heading=>{
          const details=document.createElement('details');details.className='phone-disclosure';
          details.open=/Plans on sale|Ad networks|Ads are|Ads &|Ads and/i.test(heading.textContent);
          const summary=document.createElement('summary');summary.textContent=heading.textContent;
          heading.before(details);details.appendChild(summary);
          let next=heading.nextElementSibling;heading.remove();
          while(next && !['H2','H3','DETAILS'].includes(next.tagName)) {const after=next.nextElementSibling;details.appendChild(next);next=after;}
        });
      }
      modal.querySelectorAll('div[style]').forEach(el=>{
        if(el.style.display==='grid')el.classList.add('phone-grid');
        if(el.style.display==='flex' && !el.closest('td') && (el.children.length>1))el.classList.add('phone-stack');
      });
      modal.querySelectorAll('table').forEach(table=>{
        table.classList.add('phone-cards');
        const head=[...table.rows].find(row=>row.querySelector('th'));
        const labels=head?[...head.cells].map(c=>c.textContent.trim()):['Version','Status','Actions'];
        if(head)head.classList.add('phone-table-head');
        [...table.rows].forEach(row=>{
          if(row===head)return;
          if(row.cells.length===1)row.classList.add('phone-card-single');
          [...row.cells].forEach((cell,i)=>{cell.dataset.label=row.cells.length===1?'':(labels[i]||(cell.querySelector('button')?'Actions':''));});
        });
      });
    } finally { observer.observe(modal,{childList:true,subtree:true}); }
  }
  const observer=new MutationObserver(organize);
  organize();
})();
