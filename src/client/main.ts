/**
 * Power BI Lineage — client-side dashboard runtime.
 *
 * Moved out of the embedded <script> block in src/html-generator.ts
 * during the Stop-5 client split. Still a single file for now; the
 * follow-up PRs will carve this into panels/ components/ render/
 * state/ modules without another mechanical-extraction turn.
 *
 * Globals (DATA, MARKDOWN*, REPORT_NAME, APP_VERSION, GENERATED_AT,
 * DaxHighlight) are declared ambiently in ./globals.d.ts — the server
 * injects them into the same <script> block just before this file's
 * compiled output is inlined.
 *
 * This file is written intentionally as a *script* (no imports, no
 * exports), so TypeScript emits it as a plain browser-ready .js that
 * runs top-to-bottom. The bootstrap call at the very bottom kicks
 * everything off once the DOM is ready.
 */

// @ts-nocheck -- Client is untyped JS by origin; the Stop-5 follow-up
// will tighten this panel by panel. Leaving errors off for the initial
// carve keeps the diff review-able.

let activeMd="model";
let mdViewMode="rendered";

// escHtml, escAttr, sc, uc live in src/client/render/escape.ts now
// (Stop 5 pass 2). They're compiled as a separate script file and
// concatenated into the same inline <script> before this one, so
// the top-level function declarations are already in scope.

function toggleTheme(){
  var cur=document.documentElement.getAttribute('data-theme')||'dark';
  var next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{localStorage.setItem('usage-theme',next);}catch(e){}
  var btn=document.getElementById('theme-btn');
  if(btn)btn.textContent=next==='dark'?'☾':'☀';
}

// Colourise every .lineage-dax block that hasn't been highlighted
// yet. Safe to call repeatedly — DaxHighlight.highlightElement is
// idempotent via a __daxHighlighted flag, and we filter on the
// .code-dax class the highlighter adds on first pass.
//
// MUST run BEFORE addCopyButtons — the highlighter replaces innerHTML,
// which would wipe any already-appended copy button. Current order:
//   1. renderX() sets innerHTML with raw DAX
//   2. highlightDaxBlocks() replaces innerHTML with coloured spans
//   3. addCopyButtons() appends the ⎘ button to the highlighted block
function highlightDaxBlocks(){
  if (typeof DaxHighlight === 'undefined') return;       // vendor script not loaded
  DaxHighlight.highlightAll(document, '.lineage-dax:not(.code-dax)');
  // Markdown-rendered code blocks also get highlighted (the Docs tab
  // renders ```dax fences into <pre><code class="language-dax">).
  DaxHighlight.highlightAll(document, 'pre code.language-dax:not(.code-dax)');
}

function addCopyButtons(){
  highlightDaxBlocks();
  document.querySelectorAll('.lineage-dax:not([data-copy-wired])').forEach(function(el){
    el.setAttribute('data-copy-wired','1');
    var dax=el.textContent;
    el.setAttribute('data-dax',dax);
    var btn=document.createElement('button');
    btn.className='copy-btn';
    btn.textContent='⎘';
    btn.title='Copy DAX';
    btn.onclick=function(e){
      e.stopPropagation();
      var text=el.getAttribute('data-dax')||'';
      function ok(){btn.textContent='✓';btn.classList.add('copied');setTimeout(function(){btn.textContent='⎘';btn.classList.remove('copied');},1500);}
      function fallback(){
        var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
        var success=false;try{success=document.execCommand('copy');}catch(err){}
        document.body.removeChild(ta);
        if(success)ok();else{btn.textContent='✗';setTimeout(function(){btn.textContent='⎘';},1500);}
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(ok).catch(fallback);
      }else{fallback();}
    };
    el.appendChild(btn);
  });
}
(function(){var t=document.documentElement.getAttribute('data-theme')||'dark';var btn=document.getElementById('theme-btn');if(btn)btn.textContent=t==='dark'?'☾':'☀';})();

let activeTab="measures",lastTab="measures";
let sortState={measures:{key:"usageCount",desc:true},columns:{key:"usageCount",desc:true}};
let showUnusedOnly={measures:false,columns:false};
let searchTerms={measures:"",columns:""};
let openPages=new Set();
let openTables=new Set();

// Page data is built server-side now (data-builder.ts) so we get the
// full page list — including text-only / empty pages that have no
// data-field bindings. Previously this was recomputed in the client
// from measure/column usedIn lists, which silently dropped any page
// whose visuals didn't touch the model (producing -ve "visible" counts
// when hiddenPages > bound pages).
const pageData=(DATA.pages||[]).slice();

// ─────────────────────────────────────────────────────────────────────
// Event delegation — one document-level click listener dispatches to
// action handlers based on [data-action] markers.
//
// WHY: every inline click handler used to splice a field name
// directly into a JS string literal. A measure named
//   foo'),alert(1),('bar
// would break out and execute. We now put the name in [data-name]
// (HTML-attribute encoded, safe) and read it via element.dataset.name
// — the browser decodes it back to a plain string with no parsing of
// user content as JS.
//
// Adding a new action:
//   1. Add a case below with the handler call.
//   2. Render the target element with a data-action attribute set to
//      the verb plus any data-* attributes the case reads.
//   3. Use escAttr(userValue) when the value comes from the model.
//
// .closest() walks from e.target upwards and returns the innermost
// [data-action] element, so a chip inside a page-header fires the
// chip's action without bubbling to the parent's toggle — no need
// for event.stopPropagation() at each site.
// ─────────────────────────────────────────────────────────────────────
document.addEventListener('click', function(e){
  var el = e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  var a = el.getAttribute('data-action');
  var d = el.dataset;
  switch(a){
    case 'lineage':         navigateLineage(d.type, d.name); break;
    case 'tab':             switchTab(d.tab); break;
    case 'md-tab':          switchMd(d.md); break;
    case 'md-mode':         switchMdMode(d.mode); break;
    case 'sort':            sortTable(d.table, d.key); break;
    case 'unused-filter':   toggleUnused(d.entity); break;
    case 'theme':           toggleTheme(); break;
    case 'reload':          location.reload(); break;
    case 'md-expand-all':   expandAllDetails(); break;
    case 'md-collapse-all': collapseAllDetails(); break;
    case 'md-copy':         copyMarkdown(); break;
    case 'md-download':     downloadMarkdown(); break;
    case 'page-toggle':     togglePage(d.name); break;
    case 'table-toggle':    toggleTableCard(d.name); break;
    case 'table-group-toggle': toggleTableGroup(d.group); break;
    case 'orphan-toggle':   toggleOrphanSection(d.section); break;
    case 'toggle-auto-date': toggleAutoDate(); break;
    case 'card-toggle':     el.parentElement.classList.toggle('open'); break;
    case 'erd-toggle':      toggleErdFilter(d.filter); break;
    case 'erd-reset':       resetErdLayout(); break;
    case 'erd-fit':         fitErdView(); break;
  }
});

// Parallel delegator for input events — the Measures and Columns tab
// search boxes used to carry inline `oninput="filterTable(...)"`
// attributes. Stop 4 migrated every click handler to data-action but
// missed the oninput ones; this closes the "no inline handlers"
// invariant. Same structural guarantee: user text reaches
// filterTable via HTMLInputElement.value (browser-decoded, safe).
document.addEventListener('input', function(e){
  var el = e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  var a = el.getAttribute('data-action');
  var d = el.dataset;
  switch (a) {
    case 'filter': filterTable(d.entity, el.value); break;
  }
});

// uc — see src/client/render/escape.ts

function renderSummary(){
  const t=DATA.totals;
  const totalOrphan=t.measuresUnused+t.columnsUnused;
  const hiddenCount=(DATA.hiddenPages||[]).length;
  const visibleCount=t.pages-hiddenCount;
  const tipDirect=`Fields bound to at least one visual (data well, filter, or conditional formatting). ${t.measuresDirect} measures · ${t.columnsDirect} columns.`;
  const tipIndirect=`Not on any visual, but referenced by direct measures via DAX or used in a relationship — keep these. ${t.measuresIndirect} measures · ${t.columnsIndirect} columns.`;
  const tipUnused=`Not referenced anywhere in the report — safe to remove. ${t.measuresUnused} measures · ${t.columnsUnused} columns.`;
  const tipPages=`Total pages in the report. ${visibleCount} visible · ${hiddenCount} hidden (tooltip / drillthrough / nav-suppressed).`;
  const tipVisuals=`Total visuals across all pages.`;
  document.getElementById("summary").innerHTML=`
    <div class="stat has-tip" data-tooltip="${tipDirect}"><div class="stat-value good">${t.measuresDirect+t.columnsDirect}</div><div class="stat-label">Direct</div><div class="stat-detail">${t.measuresDirect}M · ${t.columnsDirect}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipIndirect}"><div class="stat-value ${t.measuresIndirect+t.columnsIndirect>0?'warn':''}">${t.measuresIndirect+t.columnsIndirect}</div><div class="stat-label">Indirect</div><div class="stat-detail">${t.measuresIndirect}M · ${t.columnsIndirect}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipUnused}"><div class="stat-value ${totalOrphan>0?'danger':''}">${totalOrphan}</div><div class="stat-label">Unused</div><div class="stat-detail">${t.measuresUnused}M · ${t.columnsUnused}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipPages}"><div class="stat-value">${t.pages}</div><div class="stat-label">Pages</div><div class="stat-detail">${visibleCount}V · ${hiddenCount}H</div></div>
    <div class="stat has-tip" data-tooltip="${tipVisuals}"><div class="stat-value">${t.visuals}</div><div class="stat-label">Visuals</div></div>
  `;
}

// Auto-generated `LocalDateTable_<guid>` / `DateTableTemplate_<guid>`
// tables are infrastructure, not user content. We hide them from
// default counts and rendering; a toggle on the Tables / Sources tab
// lets users opt into seeing them. On the H&S composite model this
// cuts 10 noise entries out of the 53-table list.
let showAutoDate = false;
function visibleTables(){ return (DATA.tables||[]).filter(t=>showAutoDate||t.origin!=="auto-date"); }
function autoDateCount(){ return (DATA.tables||[]).filter(t=>t.origin==="auto-date").length; }
function toggleAutoDate(){ showAutoDate = !showAutoDate; renderTabs(); renderTables(); renderSources(); }

function renderTabs(){
  const um=DATA.totals.measuresUnused+DATA.totals.columnsUnused;
  const vt=visibleTables();
  const adc=autoDateCount();
  // Bottom-up build order: data foundations first, then calculation logic,
  // then consumption (pages), then analysis (unused/lineage), then docs.
  document.getElementById("tabs").innerHTML=[
    // Orientation — ERD is the holistic Source→Table→Relationship
    // map. First tab so the model's shape is the landing view.
    {id:"erd",l:"ERD",b:null},
    // Data layer
    {id:"sources",l:"Sources",b:vt.filter(function(t){return (t.partitions||[]).length>0;}).length},
    {id:"tables",l:"Tables",b:vt.length},
    {id:"columns",l:"Columns",b:DATA.columns.length},
    {id:"relationships",l:"Relationships",b:DATA.relationships.length},
    // Calculation layer
    {id:"measures",l:"Measures",b:DATA.measures.length},
    {id:"calcgroups",l:"Calc Groups",b:DATA.calcGroups.length},
    {id:"functions",l:"Functions",b:DATA.functions.filter(f=>!f.name.endsWith('.About')).length},
    // Consumption
    {id:"pages",l:"Pages",b:pageData.length},
    // Analysis
    {id:"unused",l:"Unused",b:um,w:um>0},
    {id:"lineage",l:"Lineage",b:null},
    // Output
    {id:"docs",l:"Docs",b:null}
  ].map(t=>`<button class="tab ${activeTab===t.id?'active':''}" data-action="tab" data-tab="${t.id}">${t.l}${t.b!==null?`<span class="tab-count ${t.w?'warn':''}">${t.b}</span>`:''}</button>`).join("");
}

// Shared panel-footer writer. Each render* function calls this at the end
// with its own count string on the left and (optionally) a sort / meta on
// the right. Writes into a target element by id; silent if absent.
function setPanelFooter(id, leftHtml, rightHtml){
  var el=document.getElementById(id);
  if(!el)return;
  var left='<div class="left">'+leftHtml+'</div>';
  var right=rightHtml?'<div class="right">'+rightHtml+'</div>':'';
  el.innerHTML=left+right;
}
function sortIndicator(state){
  if(!state||!state.key)return "";
  return 'Sorted by '+state.key+' '+(state.desc?'↓':'↑');
}

function switchTab(id){
  if(id!=="lineage")lastTab=id;
  activeTab=id;renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-"+id).classList.add("active");
  if(id==="lineage"&&!document.getElementById("lineage-content").innerHTML.trim())
    document.getElementById("lineage-content").innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text-faint)"><div style="font-size:16px;margin-bottom:8px">Click a measure or column name to view its lineage</div><div style="font-size:12px">Go to the Measures or Columns tab and click any field name</div></div>';
  // Functions + Calc Groups tabs display DAX bodies. Running through
  // addCopyButtons() here (which also highlights) colourises any new
  // blocks that weren't highlighted at initial render.
  if(id==="functions"||id==="calcgroups"||id==="lineage")addCopyButtons();
}

// sc — see src/client/render/escape.ts
function renderMeasures(){
  let items=[...DATA.measures];const s=sortState.measures;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.measures)items=items.filter(m=>m.status!=='direct');
  if(searchTerms.measures){const q=searchTerms.measures.toLowerCase();items=items.filter(m=>m.name.toLowerCase().includes(q)||m.table.toLowerCase().includes(q));}
  document.getElementById("tbody-measures").innerHTML=items.map(m=>{
    const deps=m.daxDependencies.map(d=>`<span class="dep-chip" data-action="lineage" data-type="measure" data-name="${escAttr(d)}">${escHtml(d)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const pages=[...new Set(m.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>`<span class="used-chip">${escHtml(p)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const statusBadge=m.status==='indirect'?'<span class="badge badge--indirect">↻ INDIRECT</span>':m.status==='unused'?'<span class="badge badge--unused">⚠ UNUSED</span>':'';
    const nameAttr=m.description?' title="'+escAttr(m.description)+'" data-desc="1"':'';
    const descRow=m.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(m.description)+'</div>':'';
    return `<tr class="${sc(m.status)}"><td><span class="field-name"${nameAttr} data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>${statusBadge}${descRow}</td><td><span class="field-table">${escHtml(m.table)}</span></td><td><span class="usage-count ${uc(m.usageCount)}">${m.usageCount}</span></td><td><span class="usage-count ${uc(m.pageCount)}">${m.pageCount}</span></td><td>${deps}</td><td>${used}</td><td><span class="format-str">${escHtml(m.formatString||'—')}</span></td></tr>`;
  }).join("");
  setPanelFooter("footer-measures",
    "Showing "+items.length+" of "+DATA.measures.length+" measures · "+DATA.totals.measuresUnused+" unused · "+DATA.totals.measuresIndirect+" indirect",
    sortIndicator(sortState.measures));
}

function renderColumns(){
  let items=[...DATA.columns];const s=sortState.columns;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.columns)items=items.filter(c=>c.status!=='direct');
  if(searchTerms.columns){const q=searchTerms.columns.toLowerCase();items=items.filter(c=>c.name.toLowerCase().includes(q)||c.table.toLowerCase().includes(q));}
  document.getElementById("tbody-columns").innerHTML=items.map(c=>{
    const pages=[...new Set(c.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>`<span class="used-chip">${escHtml(p)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    // SLICER badge intentionally omitted here — it now lives on the per-column
    // row inside the Tables tab, next to PK/FK/CALC/HIDDEN, where it's more
    // useful in context.
    const statusBadge=c.status==='indirect'?'<span class="badge badge--indirect">↻ INDIRECT</span>':c.status==='unused'?'<span class="badge badge--unused">⚠ UNUSED</span>':'';
    const cNameAttr=c.description?' title="'+escAttr(c.description)+'" data-desc="1"':'';
    const cDescRow=c.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(c.description)+'</div>':'';
    return `<tr class="${sc(c.status)}"><td><span class="field-name"${cNameAttr} data-action="lineage" data-type="column" data-name="${escAttr(c.name)}">${escHtml(c.name)}</span>${statusBadge}${cDescRow}</td><td><span class="field-table">${escHtml(c.table)}</span></td><td><span class="mono" style="font-size:11px;color:#64748B">${escHtml(c.dataType)}</span></td><td><span class="usage-count ${uc(c.usageCount)}">${c.usageCount}</span></td><td><span class="usage-count ${uc(c.pageCount)}">${c.pageCount}</span></td><td>${used}</td></tr>`;
  }).join("");
  setPanelFooter("footer-columns",
    "Showing "+items.length+" of "+DATA.columns.length+" columns · "+DATA.totals.columnsUnused+" unused",
    sortIndicator(sortState.columns));
}

function navigateLineage(type,name){
  lastTab=activeTab!=="lineage"?activeTab:lastTab;
  activeTab="lineage";renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-lineage").classList.add("active");

  const el=document.getElementById("lineage-content");
  const backTab=type==="column"?"columns":"measures";

  if(type==="measure"){
    const m=DATA.measures.find(x=>x.name===name);
    if(!m){el.innerHTML='<div style="color:var(--clr-unused);padding:20px">Measure not found</div>';return;}

    const upstream=m.daxDependencies.map(d=>{
      const dep=DATA.measures.find(x=>x.name===d);
      return dep||{name:d,table:"?",formatString:""};
    });
    const usedFuncs=DATA.functions.filter(f=>!f.name.endsWith('.About')&&(m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'(')));
    const feedsInto=DATA.measures.filter(x=>x.daxDependencies.includes(m.name));
    // EXTERNALMEASURE proxy is now detected server-side (data-builder.ts)
    // and attached to the measure as a structured `externalProxy` field.
    // The regex fallback stays for back-compat with older DATA payloads.
    let proxy = m.externalProxy;
    if (!proxy) {
      const extMatch = (m.daxExpression||'').match(/EXTERNALMEASURE\s*\(\s*"([^"]*)"\s*,\s*(\w+)\s*,\s*"DirectQuery to AS - ([^"]+)"\s*\)/i);
      if (extMatch) proxy = { remoteName: extMatch[1], type: extMatch[2], externalModel: extMatch[3], cluster: null };
    }
    const extModel = proxy ? proxy.externalModel : null;
    const extRemoteName = proxy ? proxy.remoteName : null;

    el.innerHTML=`
      <div class="lineage-back" data-action="tab" data-tab="${escAttr(backTab)}">← Back to ${backTab==='measures'?'Measures':'Columns'}</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:var(--clr-measure)"></span>${escHtml(m.name)}</div>
        <div class="lineage-hero-meta">${escHtml(m.table)} · ${escHtml(m.formatString||'—')} · ${m.usageCount} visual${m.usageCount!==1?'s':''} · ${m.pageCount} page${m.pageCount!==1?'s':''}</div>
        ${m.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(m.description)+'</div>':''}
        <div class="lineage-dax">${escHtml(m.daxExpression)}</div>
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-upstream)">↑ Upstream</div>
          ${usedFuncs.map(f=>`
            <div class="lc udf clickable" style="margin-bottom:4px" data-action="tab" data-tab="functions">
              <div class="lc-name" style="color:var(--clr-function)">ƒ ${escHtml(f.name)}</div>
              <div class="lc-sub">Function · ${f.parameters?f.parameters.split(',').length+' param'+(f.parameters.split(',').length!==1?'s':''):'no params'}</div>
            </div>`).join("")}
          ${extModel?`
          <div class="lc" style="border-left:3px solid var(--clr-function);margin-bottom:4px;background:var(--clr-function-soft)">
            <div class="lc-name" style="color:var(--clr-function)">⊡ ${escHtml(extModel)}</div>
            <div class="lc-sub">External semantic model · EXTERNALMEASURE${extRemoteName&&extRemoteName!==m.name?' · remote name "'+escHtml(extRemoteName)+'"':''}</div>
          </div>`:''}
          <div class="lc source" style="margin-bottom:4px">
            <div class="lc-name" style="color:var(--clr-source)">⬡ ${escHtml(m.table)}</div>
            <div class="lc-sub">Source table</div>
          </div>
          ${upstream.length?upstream.map(u=>`
            <div class="lc upstream clickable" data-action="lineage" data-type="measure" data-name="${escAttr(u.name)}">
              <div class="lc-name">${escHtml(u.name)}</div>
              <div class="lc-sub">${escHtml(u.table)} · ${escHtml(u.formatString||'')}</div>
            </div>`).join(""):`${(usedFuncs.length||extModel)?'':`<div class="lc upstream empty"><div class="lc-name">No dependencies</div><div class="lc-sub">Base measure</div></div>`}`}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-measure)">● This Measure</div>
          <div class="lc center">
            <div class="lc-name">${escHtml(m.name)}</div>
            <div class="lc-sub">${escHtml(m.daxExpression.length>50?m.daxExpression.substring(0,50)+'…':m.daxExpression)}</div>
          </div>
          ${feedsInto.length?`
            <div class="feeds-label">Feeds into</div>
            ${feedsInto.map(f=>`
              <div class="lc feeds clickable" data-action="lineage" data-type="measure" data-name="${escAttr(f.name)}">
                <div class="lc-name">${escHtml(f.name)}</div>
                <div class="lc-sub">${escHtml(f.formatString||'')} · ${f.usageCount} visual${f.usageCount!==1?'s':''}</div>
              </div>`).join("")}
          `:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-downstream)">↓ Downstream</div>
          ${m.usedIn.length?m.usedIn.map(d=>`
            <div class="lc downstream">
              <div class="lc-name">${escHtml(d.visualTitle)}</div>
              <div class="lc-sub">${escHtml(d.visualType)} · ${escHtml(d.bindingRole)}</div>
              <div class="lc-role">${escHtml(d.pageName)}</div>
            </div>`).join(""):`<div class="lc downstream empty"><div class="lc-name" style="color:var(--clr-unused)">Not used</div><div class="lc-sub">Orphaned measure</div></div>`}
        </div>
      </div>`;
    addCopyButtons();
  }
  else if(type==="column"){
    const c=DATA.columns.find(x=>x.name===name);
    if(!c){el.innerHTML='<div style="color:var(--clr-unused);padding:20px">Column not found</div>';return;}
    const colRef=c.table+'['+c.name+']';
    const related=DATA.measures.filter(m=>m.daxExpression.includes(colRef)||m.daxExpression.includes('['+c.name+']'));

    el.innerHTML=`
      <div class="lineage-back" data-action="tab" data-tab="columns">← Back to Columns</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:var(--clr-column)"></span>${escHtml(c.name)}</div>
        <div class="lineage-hero-meta">${escHtml(c.table)} · ${escHtml(c.dataType)} · ${c.usageCount} visual${c.usageCount!==1?'s':''} · ${c.pageCount} page${c.pageCount!==1?'s':''}</div>
        ${c.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(c.description)+'</div>':''}
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-source)">↑ Source</div>
          <div class="lc source">
            <div class="lc-name" style="color:var(--clr-source)">⬡ ${escHtml(c.table)}</div>
            <div class="lc-sub">${escHtml(c.dataType)}</div>
          </div>
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-column)">● This Column</div>
          <div class="lc center col-type">
            <div class="lc-name">${escHtml(c.name)}</div>
            <div class="lc-sub">${escHtml(c.table)}[${escHtml(c.name)}]</div>
          </div>
          ${related.length?`
            <div class="feeds-label">Measures referencing ${escHtml(c.name)}</div>
            ${related.map(m=>`
              <div class="lc feeds clickable" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">
                <div class="lc-name">${escHtml(m.name)}</div>
                <div class="lc-sub">${escHtml(m.formatString||'')} · ${m.usageCount} visual${m.usageCount!==1?'s':''}</div>
              </div>`).join("")}
          `:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-downstream)">↓ Downstream</div>
          ${c.usedIn.length?c.usedIn.map(d=>`
            <div class="lc downstream">
              <div class="lc-name">${escHtml(d.visualTitle)}</div>
              <div class="lc-sub">${escHtml(d.visualType)} · ${escHtml(d.bindingRole)}</div>
              <div class="lc-role">${escHtml(d.pageName)}</div>
            </div>`).join(""):`<div class="lc downstream empty"><div class="lc-name" style="color:var(--clr-unused)">Not used</div><div class="lc-sub">Orphaned column</div></div>`}
        </div>
      </div>`;
  }
}

function renderPages(){
  const FC={measure:"#F59E0B",column:"#3B82F6"};
  const hiddenSet=new Set(DATA.hiddenPages||[]);
  document.getElementById("pages-content").innerHTML=pageData.map(p=>{
    const isOpen=openPages.has(p.name);
    const hiddenBadge=hiddenSet.has(p.name)?'<span class="badge badge--hidden" title="This page is marked HiddenInViewMode — typically a tooltip, drillthrough, or nav-suppressed page">👁 HIDDEN</span>':'';

    const typeChips=Object.entries(p.typeCounts).map(([t,c])=>`<span class="page-type-chip">${c}× ${escHtml(t)}</span>`).join("");

    const visualRows=p.visuals.map(v=>{
      const bindingChips=v.bindings.map(b=>{
        const color=b.fieldType==="measure"?FC.measure:FC.column;
        return `<span class="dep-chip" style="background:${color}15;color:${color};border-color:${color}30;cursor:pointer" data-action="lineage" data-type="${escAttr(b.fieldType)}" data-name="${escAttr(b.fieldName)}">${escHtml(b.fieldName)}</span>`;
      }).join("");
      return `<div class="page-visual-row">
        <span class="page-visual-type">${escHtml(v.type)}</span>
        <span class="page-visual-title">${escHtml(v.title)}</span>
        <div class="page-visual-bindings">${bindingChips}</div>
      </div>`;
    }).join("");

    const measureChips=p.measures.map(m=>`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m)}">${escHtml(m)}</span>`).join("");
    const columnChips=p.columns.map(c=>`<span class="dep-chip" style="background:rgba(59,130,246,.1);color:var(--clr-column);border-color:rgba(59,130,246,.2);cursor:pointer" data-action="lineage" data-type="column" data-name="${escAttr(c)}">${escHtml(c)}</span>`).join("");

    return `<div class="page-card ${isOpen?'open':''}">
      <div class="page-header" data-action="page-toggle" data-name="${escAttr(p.name)}">
        <div class="page-name">${escHtml(p.name)}${hiddenBadge}</div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-downstream)">${p.visualCount}</div><div class="page-stat-label">Visuals</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${p.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${p.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-slicer)">${p.slicerCount}</div><div class="page-stat-label">Slicers</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Visual types<span class="line"></span></div>
          <div class="page-type-summary">${typeChips}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (${p.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${measureChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Columns (${p.columnCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${columnChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Visuals (${p.visualCount})<span class="line"></span></div>
          ${visualRows||(p.visualCount>0?'<span style="color:#475569;font-size:12px">No data-bound visuals on this page — text, shape, or image only.</span>':'<span style="color:#475569;font-size:12px">Empty page.</span>')}
        </div>
      </div></div>
    </div>`;
  }).join("");
  var hiddenCount=(DATA.hiddenPages||[]).length;
  var visibleCount=pageData.length-hiddenCount;
  var totalVisuals=pageData.reduce(function(a,p){return a+(p.visualCount||0);},0);
  var pf=document.getElementById("pages-content");
  if(pf)pf.insertAdjacentHTML("beforeend",
    '<div class="panel-footer"><div class="left">'+
      pageData.length+' pages · '+visibleCount+' visible · '+hiddenCount+' hidden · '+totalVisuals+' visuals'+
    '</div></div>');
}

function togglePage(name){
  if(openPages.has(name))openPages.delete(name);else openPages.add(name);
  renderPages();
}

function toggleTableCard(name){
  if(openTables.has(name))openTables.delete(name);else openTables.add(name);
  renderTables();
}

// Classify a table into one of five mutually exclusive groups for the
// Tables-tab sectioning. Order of checks matters because a calc-group
// table could also technically have a "measure" name etc. — we take
// the most-specific category first.
function tableGroupKey(t){
  if(t.parameterKind==='field')return 'field-param';
  if(t.parameterKind==='compositeModelProxy')return 'proxy';
  if(t.isCalcGroup)return 'calcgroup';
  // "Measure home" tables — host measures with (usually) one placeholder
  // column. Heuristic matches `_measures`, `_Rollup_measures`, etc.
  if((t.measureCount||0)>0 && (t.columnCount||0)<=1 && /measure/i.test(t.name))return 'measure';
  return 'data';
}
// Display metadata for each group. `defaultOpen:true` means the group
// body is visible on first load (the user can still collapse it).
const TABLE_GROUPS=[
  {key:'data',        label:'Data Tables',             defaultOpen:false, icon:'▦'},
  {key:'measure',     label:'Measure Tables',          defaultOpen:false, icon:'ƒ'},
  {key:'field-param', label:'Field Parameters',        defaultOpen:false, icon:'▣'},
  {key:'proxy',       label:'Composite Model Proxies', defaultOpen:false, icon:'◈'},
  {key:'calcgroup',   label:'Calculation Groups',      defaultOpen:false, icon:'🧮'},
];
// Track which groups the user has toggled away from their default.
// Default state is derived per-group; this set stores the flips.
var flippedTableGroups = new Set();
function isTableGroupOpen(key){
  const def = (TABLE_GROUPS.find(g=>g.key===key)||{}).defaultOpen;
  return flippedTableGroups.has(key) ? !def : def;
}
function toggleTableGroup(key){
  if(flippedTableGroups.has(key))flippedTableGroups.delete(key);
  else flippedTableGroups.add(key);
  renderTables();
}

function renderTables(){
  const tables=visibleTables();
  // Precompute slicer lookup once per render so the per-row badge stays cheap.
  // TableColumnData doesn't carry isSlicerField — it lives on the flat ModelColumn.
  const slicerSet=new Set((DATA.columns||[]).filter(c=>c.isSlicerField).map(c=>c.table+'|'+c.name));

  // Partition visible tables into the five groups.
  const byGroup = new Map(TABLE_GROUPS.map(g=>[g.key,[]]));
  for(const t of tables){
    const k = tableGroupKey(t);
    byGroup.get(k).push(t);
  }

  function cardHtml(t){
    const isOpen=openTables.has(t.name);

    const colRows=t.columns.map(c=>{
      const badges=[];
      if(c.isKey)badges.push('<span class="badge badge--pk" title="Primary key — isKey:true set in the model">🔑 PK</span>');
      else if(c.isInferredPK)badges.push('<span class="badge badge--pk-inf" title="Inferred primary key — this column is on the one-side of at least one relationship">🗝 PK</span>');
      if(c.isFK)badges.push('<span class="badge badge--fk" title="Foreign key — used as fromColumn in a relationship">🔗 FK</span>');
      if(c.isCalculated)badges.push('<span class="badge badge--calc" title="Calculated column">🧮 CALC</span>');
      if(c.isHidden)badges.push('<span class="badge badge--hid-col" title="isHidden:true">👁 HIDDEN</span>');
      if(slicerSet.has(t.name+'|'+c.name))badges.push('<span class="badge badge--slicer" title="Bound to at least one slicer visual">🎚 SLICER</span>');
      const statusClass=c.status==='unused'?'zero':c.status==='indirect'?'low':'good';
      // Relationship column: FK target (outgoing) or incoming PK refs, or both if the column is a bridge
      const parts=[];
      if(c.isFK&&c.fkTarget)parts.push(`<span class="rel-out">→ ${escHtml(c.fkTarget.table)}[${escHtml(c.fkTarget.column)}]</span>`);
      if(c.incomingRefs&&c.incomingRefs.length>0){
        const refs=c.incomingRefs.map(r=>`<span class="rel-in${r.isActive?'':' rel-inactive'}">← ${escHtml(r.table)}[${escHtml(r.column)}]${r.isActive?'':' <span style="font-size:9px;opacity:.7">(inactive)</span>'}</span>`).join('<span style="color:var(--text-fainter);margin:0 4px">·</span>');
        parts.push(refs);
      }
      const relText=parts.length?parts.join('<br>'):'<span style="color:var(--text-fainter)">—</span>';
      const colDesc=c.description?'<div class="desc-muted" style="margin-top:3px">'+escHtml(c.description)+'</div>':'';
      return `<div class="tcol-row">
        <div>
          <span class="tcol-name" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}">${escHtml(c.name)}</span>${badges.join('')}
          <span class="usage-count ${statusClass}" style="margin-left:8px;font-size:10px">${c.usageCount}</span>
          ${colDesc}
        </div>
        <div class="tcol-type">${escHtml(c.dataType)}</div>
        <div class="tcol-fk">${relText}</div>
      </div>`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No columns</div>';

    const measureList=t.measures.map(m=>{
      const cls=m.status==='unused'?'zero':m.status==='indirect'?'low':'good';
      return `<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)} <span class="usage-count ${cls}" style="margin-left:4px;font-size:9px">${m.usageCount}</span></span>`;
    }).join("")||'<span style="color:var(--text-faint);font-size:12px">None</span>';

    const relRows=t.relationships.map(r=>{
      const dirClass=r.direction==='outgoing'?'badge--direction-out':'badge--direction-in';
      const dirLabel=r.direction==='outgoing'?'FK →':'← PK';
      const inactive=r.isActive?'':' trel-inactive';
      const arrow=r.direction==='outgoing'?'→':'←';
      const other=r.direction==='outgoing'?`${escHtml(r.toTable)}[${escHtml(r.toColumn)}]`:`${escHtml(r.fromTable)}[${escHtml(r.fromColumn)}]`;
      const self=r.direction==='outgoing'?`[${escHtml(r.fromColumn)}]`:`[${escHtml(r.toColumn)}]`;
      return `<div class="trel-row${inactive}">
        <span class="badge ${dirClass}">${dirLabel}</span>
        <span>${self} <span style="color:var(--text-faint)">${arrow}</span> ${other}</span>
        ${r.isActive?'':'<span style="font-size:9px;color:var(--text-dim);margin-left:4px">(inactive)</span>'}
      </div>`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No relationships</div>';

    const tableDesc=t.description?'<div class="desc-line">'+escHtml(t.description)+'</div>':'';
    return `<div class="page-card ${isOpen?'open':''}">
      <div class="page-header" data-action="table-toggle" data-name="${escAttr(t.name)}">
        <div style="flex:1;min-width:0">
          <div class="page-name">${escHtml(t.name)}</div>
          ${tableDesc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${t.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${t.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${t.keyCount}</div><div class="page-stat-label">Keys</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${t.fkCount}</div><div class="page-stat-label">FKs</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Columns (${t.columnCount})<span class="line"></span></div>
          <div class="tcol-row" style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);font-weight:600;border-bottom:1px solid var(--border);padding-bottom:4px">
            <div>Name</div><div>Type</div><div>Relationship</div>
          </div>
          ${colRows}
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (${t.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${measureList}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Relationships (${t.relationships.length})<span class="line"></span></div>
          ${relRows}
        </div>
      </div></div>
    </div>`;
  } // end cardHtml

  // Render the grouped sections. Sort tables alphabetically within
  // each group; the group order comes from TABLE_GROUPS. Empty
  // groups are omitted so the UI doesn't show empty "0 tables"
  // section headers for models that have no parameters / proxies.
  const sectionsHtml = TABLE_GROUPS.map(g=>{
    const groupTables = (byGroup.get(g.key)||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
    if(groupTables.length===0)return '';
    const open = isTableGroupOpen(g.key);
    const groupCols = groupTables.reduce((a,t)=>a+(t.columnCount||0),0);
    const groupMs  = groupTables.reduce((a,t)=>a+(t.measureCount||0),0);
    const metaParts = [groupTables.length+' table'+(groupTables.length===1?'':'s')];
    if(groupCols>0) metaParts.push(groupCols+' col'+(groupCols===1?'':'s'));
    if(groupMs>0)   metaParts.push(groupMs+' measure'+(groupMs===1?'':'s'));
    const bodyHtml = open ? groupTables.map(cardHtml).join("") : '';
    return `<div class="table-group ${open?'open':''}">
      <div class="table-group-header" data-action="table-group-toggle" data-group="${escAttr(g.key)}">
        <span class="table-group-chev" aria-hidden="true"></span>
        <span class="table-group-icon">${g.icon}</span>
        <span class="table-group-title">${escHtml(g.label)}</span>
        <span class="table-group-meta">${metaParts.join(' · ')}</span>
      </div>
      <div class="table-group-body">${bodyHtml}</div>
    </div>`;
  }).join("");
  document.getElementById("tables-content").innerHTML =
    sectionsHtml || '<div style="text-align:center;padding:60px 20px;color:var(--text-faint);font-size:13px">No tables found</div>';

  var totalCols=tables.reduce(function(a,t){return a+(t.columnCount||0);},0);
  var totalMs=tables.reduce(function(a,t){return a+(t.measureCount||0);},0);
  var adc=autoDateCount();
  var pf=document.getElementById("tables-content");
  if(pf){
    // Footer shows visible-table totals + a toggle for the auto-date
    // tables Power BI generates as calendar infrastructure. The toggle
    // is only rendered when the model actually has some to hide/show.
    var autoToggle = adc > 0
      ? '<button class="filter-btn'+(showAutoDate?' active':'')+'" data-action="toggle-auto-date" title="'+
          (showAutoDate?'Hide':'Show')+' LocalDateTable_* and DateTableTemplate_* auto-generated tables">'+
        (showAutoDate?'Hide':'Show')+' auto-date ('+adc+')</button>'
      : '';
    pf.insertAdjacentHTML("beforeend",
      '<div class="panel-footer"><div class="left">'+
        tables.length+' tables · '+totalCols+' columns · '+totalMs+' measures'+
        (adc>0 && !showAutoDate ? ' · <span style="color:var(--text-faint)">+'+adc+' auto-date hidden</span>' : '')+
      '</div><div class="right">'+autoToggle+'</div></div>');
  }
}

var openOrphanSections=new Set();
function toggleOrphanSection(id){if(openOrphanSections.has(id))openOrphanSections.delete(id);else openOrphanSections.add(id);renderUnused();}

function orphanSection(id,title,subtitle,color,count,countLabel,items){
  const isOpen=openOrphanSections.has(id);
  return `<div class="page-card ${isOpen?'open':''}" style="border-left:3px solid ${color}">
    <div class="page-header" data-action="orphan-toggle" data-section="${escAttr(id)}">
      <div style="flex:1">
        <div class="page-name" style="font-size:14px">${escHtml(title)}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">${escHtml(subtitle)}</div>
      </div>
      <div class="page-stats">
        <div class="page-stat"><div class="page-stat-val" style="color:${color}">${count}</div><div class="page-stat-label">${escHtml(countLabel)}</div></div>
      </div>
      <span class="page-expand" aria-hidden="true"></span>
    </div>
    <div class="page-body"><div class="page-body-inner">
      <div style="display:flex;flex-wrap:wrap;gap:8px">${items}</div>
    </div></div>
  </div>`;
}

function renderUnused(){
  const unusedM=DATA.measures.filter(m=>m.status==='unused'),indirectM=DATA.measures.filter(m=>m.status==='indirect');
  const unusedC=DATA.columns.filter(c=>c.status==='unused'),indirectC=DATA.columns.filter(c=>c.status==='indirect');
  const pureOrphanM=unusedM.filter(m=>!m.dependedOnBy.length);
  const chainOrphanM=unusedM.filter(m=>m.dependedOnBy.length>0);
  let h='';

  if(pureOrphanM.length) h+=orphanSection('pure-m','Unused Measures — Not Referenced Anywhere','No visual uses them and no other measure references them — safe to remove','var(--clr-unused)',pureOrphanM.length,'Measures',
    pureOrphanM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')}</div></div>`).join(""));

  if(chainOrphanM.length) h+=orphanSection('chain-m','Unused Measures — Dead Chain','Other measures depend on them, but the full chain never reaches any visual','var(--clr-unused)',chainOrphanM.length,'Measures',
    chainOrphanM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')} · depended on by ${m.dependedOnBy.length}</div></div>`).join(""));

  if(unusedC.length) h+=orphanSection('orphan-c','Unused Columns','No visual, measure, or relationship uses them — safe to hide or remove','var(--clr-unused)',unusedC.length,'Columns',
    unusedC.map(c=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}"><div class="lc-name">${escHtml(c.name)}</div><div class="lc-sub">${escHtml(c.table)} · ${escHtml(c.dataType)}</div></div>`).join(""));

  if(indirectM.length) h+=orphanSection('indirect-m','Indirect Measures','Not on any visual, but used inside other measures that are — keep these','var(--clr-indirect)',indirectM.length,'Measures',
    indirectM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-indirect);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')}</div></div>`).join(""));

  if(indirectC.length) h+=orphanSection('indirect-c','Indirect Columns','Not on any visual, but used in a relationship or measure DAX — keep these','var(--clr-indirect)',indirectC.length,'Columns',
    indirectC.map(c=>`<div class="lc clickable" style="border-left:3px solid var(--clr-indirect);flex:0 0 auto" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}"><div class="lc-name">${escHtml(c.name)}</div><div class="lc-sub">${escHtml(c.table)} · ${escHtml(c.dataType)}</div></div>`).join(""));

  if(!unusedM.length&&!unusedC.length&&!indirectM.length&&!indirectC.length)h='<div style="text-align:center;padding:40px;color:var(--clr-success);font-weight:600">All fields are in use ✓</div>';
  var totalUnused=unusedM.length+unusedC.length;
  h+='<div class="panel-footer"><div class="left">'+
    (totalUnused?totalUnused+' unused items · safe to review for removal':'No unused items to review')+
    '</div></div>';
  document.getElementById("unused-content").innerHTML=h;
}

function renderSources(){
  var host=document.getElementById("sources-content");
  if(!host)return;

  // ── Model properties card (top of the tab) ────────────────────────────────
  var mp=DATA.modelProperties||{};
  var culturesLabel=(mp.cultures&&mp.cultures.length>0)?mp.cultures.join(", "):(mp.culture||"\u2014");
  var implicitLabel=mp.discourageImplicitMeasures?"Discouraged":"Allowed";
  var valueFilterLabel=mp.valueFilterBehavior||"Automatic (default)";
  var compatLevel=DATA.compatibilityLevel!=null?DATA.compatibilityLevel:"\u2014";
  var modelDesc=mp.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(mp.description)+'</div>':'';
  var propsRows=
    '<tr><td><strong>Compatibility level</strong></td><td>'+escHtml(String(compatLevel))+'</td></tr>'+
    '<tr><td><strong>Cultures</strong></td><td>'+escHtml(culturesLabel)+'</td></tr>'+
    '<tr><td><strong>Implicit measures</strong></td><td>'+escHtml(implicitLabel)+'</td></tr>'+
    '<tr><td><strong>Value filter behavior</strong></td><td>'+escHtml(valueFilterLabel)+'</td></tr>';
  if(mp.sourceQueryCulture){
    propsRows+='<tr><td><strong>Source query culture</strong></td><td>'+escHtml(mp.sourceQueryCulture)+'</td></tr>';
  }
  if(mp.defaultPowerBIDataSourceVersion){
    propsRows+='<tr><td><strong>Datasource version</strong></td><td>'+escHtml(mp.defaultPowerBIDataSourceVersion)+'</td></tr>';
  }
  var modelPropsCard=
    '<div class="page-card" style="margin-bottom:14px">'+
      '<div class="page-header" style="cursor:default"><div style="flex:1">'+
        '<div class="page-name" style="font-size:14px">Model properties</div>'+
        '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Top-level metadata from <code>model.tmdl</code> / <code>database.tmdl</code> / <code>cultures/</code>. Server and Database name are runtime-only and not stored in the files.</div>'+
        modelDesc+
      '</div></div>'+
      '<div style="padding:0 18px 14px">'+
        '<table class="data-table"><tbody>'+propsRows+'</tbody></table>'+
      '</div>'+
    '</div>';

  var tablesWithSources=visibleTables().filter(function(t){return (t.partitions||[]).length>0;});
  var modeCounts={};
  var totalParts=0;
  tablesWithSources.forEach(function(t){
    (t.partitions||[]).forEach(function(p){
      var m=(p.mode||"import").toLowerCase();
      modeCounts[m]=(modeCounts[m]||0)+1;
      totalParts++;
    });
  });

  var modeChips=Object.keys(modeCounts).sort(function(a,b){return modeCounts[b]-modeCounts[a];}).map(function(m){
    return '<span class="dep-chip" style="background:rgba(59,130,246,.1);color:var(--clr-column);border-color:rgba(59,130,246,.2)">'+modeCounts[m]+'\u00d7 '+escHtml(m)+'</span>';
  }).join('');

  var compatLine=DATA.compatibilityLevel
    ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">Compatibility level: <strong style="color:var(--text)">'+DATA.compatibilityLevel+'</strong></div>'
    : '';

  var summary=
    '<div class="page-card" style="margin-bottom:14px">'+
      '<div class="page-header" style="cursor:default">'+
        '<div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Storage modes</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+tablesWithSources.length+' table'+(tablesWithSources.length===1?'':'s')+' with sources · '+totalParts+' partition'+(totalParts===1?'':'s')+'</div>'+
          '<div style="margin-top:8px">'+(modeChips||'<span style="color:var(--text-faint)">None</span>')+'</div>'+
          compatLine+
        '</div>'+
      '</div>'+
    '</div>';

  // Parameters / expressions block
  var exprBlock="";
  if((DATA.expressions||[]).length>0){
    var rows=DATA.expressions.map(function(e){
      var kind=e.kind==="parameter"?"Parameter":"M expression";
      var val=String(e.value||"");
      if(val.length>120)val=val.substring(0,117)+"\u2026";
      var desc=e.description?'<div class="desc-muted" style="margin-top:3px;font-size:11px">'+escHtml(e.description)+'</div>':'';
      return '<tr><td><strong>'+escHtml(e.name)+'</strong>'+desc+'</td><td><span class="field-table">'+kind+'</span></td><td><code style="font-size:11px;color:var(--code-name)">'+escHtml(val)+'</code></td></tr>';
    }).join('');
    exprBlock=
      '<div class="page-card" style="margin-bottom:14px">'+
        '<div class="page-header" style="cursor:default"><div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Parameters &amp; expressions</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Top-level M expressions defined in <code>expressions.tmdl</code></div>'+
        '</div></div>'+
        '<div style="padding:0 18px 14px">'+
          '<table class="data-table"><thead><tr><th>Name</th><th>Kind</th><th>Value</th></tr></thead><tbody>'+rows+'</tbody></table>'+
        '</div>'+
      '</div>';
  }

  // Per-table sources
  var perTableBlock="";
  if(tablesWithSources.length>0){
    var sourceRows="";
    tablesWithSources.forEach(function(t){
      (t.partitions||[]).forEach(function(p){
        var loc=p.sourceLocation?'<code style="font-size:11px;color:var(--text-muted);word-break:break-all">'+escHtml(p.sourceLocation)+'</code>':'<span style="color:var(--text-faint)">\u2014</span>';
        sourceRows+=
          '<tr>'+
            '<td><strong>'+escHtml(t.name)+'</strong></td>'+
            '<td><span class="dep-chip" style="background:rgba(34,197,94,.1);color:var(--clr-success);border-color:rgba(34,197,94,.2)">'+escHtml(p.mode||'import')+'</span></td>'+
            '<td><span class="dep-chip" style="background:rgba(168,85,247,.1);color:var(--clr-calc);border-color:rgba(168,85,247,.2)">'+escHtml(p.sourceType||'Unknown')+'</span></td>'+
            '<td>'+loc+'</td>'+
          '</tr>';
      });
    });
    perTableBlock=
      '<div class="page-card">'+
        '<div class="page-header" style="cursor:default"><div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Per-table sources</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Source type is inferred from the M code; location is the first string literal in the partition source.</div>'+
        '</div></div>'+
        '<div style="padding:0 18px 14px">'+
          '<table class="data-table"><thead><tr><th>Table</th><th>Mode</th><th>Source type</th><th>Location</th></tr></thead><tbody>'+sourceRows+'</tbody></table>'+
        '</div>'+
      '</div>';
  }

  var sourcesFooter='<div class="panel-footer"><div class="left">'+
    tablesWithSources.length+' source tables'+
    '</div></div>';
  if(tablesWithSources.length===0&&(DATA.expressions||[]).length===0){
    // Even when there's no partition info, show the model properties card.
    host.innerHTML=modelPropsCard+'<div style="text-align:center;padding:40px 20px;color:var(--text-faint);font-size:13px">No partition or expression information found in this model.</div>'+sourcesFooter;
    return;
  }
  host.innerHTML=modelPropsCard+summary+exprBlock+perTableBlock+sourcesFooter;
}

function renderRelationships(){
  const rels=DATA.relationships;
  var activeCount=rels.filter(function(r){return r.isActive;}).length;
  var inactiveCount=rels.length-activeCount;
  var relFooter='<div class="panel-footer"><div class="left">'+
    rels.length+' relationships · '+activeCount+' active · '+inactiveCount+' inactive'+
    '</div></div>';
  if(!rels.length){document.getElementById("relationships-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No relationships found in the model</div>'+relFooter;return;}
  let h='<div class="table-wrap"><table class="data-table"><thead><tr><th>From Table</th><th>From Column</th><th></th><th>To Table</th><th>To Column</th><th>Status</th></tr></thead><tbody>';
  for(const r of rels){
    const statusColor=r.isActive?'var(--clr-success)':'var(--text-faint)';
    const statusLabel=r.isActive?'Active':'Inactive';
    h+=`<tr>
      <td style="font-weight:600">${r.fromTable}</td>
      <td>${r.fromColumn}</td>
      <td style="text-align:center;color:#6B7280;font-size:18px">→</td>
      <td style="font-weight:600">${r.toTable}</td>
      <td>${r.toColumn}</td>
      <td><span style="color:${statusColor};font-size:12px;font-weight:500">${statusLabel}</span></td>
    </tr>`;
  }
  h+='</tbody></table></div>'+relFooter;
  document.getElementById("relationships-content").innerHTML=h;
}

// ─── ERD tab ──────────────────────────────────────────────────────────────
// Interactive SVG entity-relationship diagram. Force-directed layout,
// pan/zoom on the background, drag-to-reposition nodes, click-to-open
// a table's card on the Tables tab. Role-coloured nodes reuse the same
// --clr-* tokens every other tab uses so the visual language is shared.
//
// Why force-directed rather than a grid / tiered layout:
//   - PBI schemas are typically star-shaped around one or more fact
//     tables; a spring-and-repulsion simulation naturally produces
//     star clusters without any domain-specific layout code.
//   - Works on snowflakes / bridges / disconnected tables without
//     special cases — the physics figures it out.
//   - O(n²) is fine up to ~100 tables; larger models should filter
//     down (the controls bar exposes toggles for the noisy kinds).
//
// Node positions persist across re-renders via `erdNodePositions` so
// toggling a filter doesn't re-scramble the tables the user already
// dragged into place. "Reset layout" forgets positions and re-runs.

// Saved per-node positions (populated after each layout run).
var erdNodePositions: Record<string, {x:number,y:number}> = {};
// Node sizes (width/height) keyed by node id — needed so the drag
// handler can recompute edge-border anchors without having to re-
// measure. Populated by each renderErd() pass.
var erdNodeSizes: Record<string, {w:number,h:number}> = {};
// Viewport transform (pan + zoom), persists across re-renders.
var erdView = { tx: 0, ty: 0, scale: 1 };
// Filter toggles — "noisy" kinds default off so the first view stays readable.
var erdFilters = { proxies: false, fieldParams: false, calcGroups: true, autoDate: false };

function erdRoleOf(t: any): string {
  if (t.origin === 'auto-date') return 'auto-date';
  if (t.isCalcGroup) return 'calc-group';
  if (t.parameterKind === 'compositeModelProxy') return 'proxy';
  if (t.parameterKind === 'field') return 'parameter';
  const out = (t.relationships || []).filter((r: any) => r.direction === 'outgoing').length;
  const inc = (t.relationships || []).filter((r: any) => r.direction === 'incoming').length;
  if (out > 0 && inc === 0) return 'fact';
  if (out === 0 && inc > 0) return 'dimension';
  if (out > 0 && inc > 0) return 'bridge';
  return 'disconnected';
}

// Per-node width is driven by the label length; keeping w/h on each
// node lets the edge-anchor math (below) clip lines to the rectangle
// border instead of running through the node's body.
const ERD_NODE_H = 40;
function erdNodeWidth(name: string): number {
  return Math.max(110, Math.min(220, (name.length * 7.2) + 24));
}

function erdBuildGraph() {
  const tables = (DATA.tables || []).filter((t: any) => {
    if (t.origin === 'auto-date') return erdFilters.autoDate;
    if (t.isCalcGroup) return erdFilters.calcGroups;
    if (t.parameterKind === 'compositeModelProxy') return erdFilters.proxies;
    if (t.parameterKind === 'field') return erdFilters.fieldParams;
    return true;
  });
  const nodes = tables.map((t: any) => ({
    id: t.name, name: t.name, role: erdRoleOf(t),
    columnCount: t.columnCount || 0,
    measureCount: t.measureCount || 0,
    w: erdNodeWidth(t.name), h: ERD_NODE_H,
    x: 0, y: 0, vx: 0, vy: 0, _fx: 0, _fy: 0,
  }));
  const visible = new Set(nodes.map((n: any) => n.id));
  const edges = (DATA.relationships || [])
    .filter((r: any) => visible.has(r.fromTable) && visible.has(r.toTable))
    .map((r: any) => ({ from: r.fromTable, to: r.toTable, active: r.isActive }));
  return { nodes, edges };
}

/**
 * Ray-rectangle intersection — returns the point where the ray from
 * (cx, cy) toward (tx, ty) exits the axis-aligned rectangle of size
 * (w, h) centred at (cx, cy). Used so relationship lines end at the
 * node's border instead of at its centre (which hides the arrowhead
 * inside the box and makes the diagram look crowded).
 */
function erdEdgeAnchor(cx: number, cy: number, w: number, h: number, tx: number, ty: number): {x:number,y:number} {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2, hh = h / 2;
  // Scale the ray so it hits the nearest border. abs-ratio picks the
  // side (top/bottom vs left/right); the smaller scale wins because
  // that's the first border the ray crosses.
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// Force-directed layout — pure JS, no deps. Deterministic given a
// seeded RNG (we use Math.random, so layouts differ between runs when
// nodes lack saved positions — that's intentional; the first render
// arranges itself, then positions stick).
function erdLayout(nodes: any[], edges: any[], width: number, height: number) {
  // Seeded initial placement by role — gives the simulation a head
  // start toward a star-schema-shaped layout instead of scrambling
  // from random starts. Facts go dead centre, dimensions on an outer
  // ring, bridges on a mid ring, and "island" kinds (disconnected /
  // calc groups / proxies / field params / auto-date) off to the side
  // so they don't get dragged into the main cluster.
  const cx = width / 2, cy = height / 2;
  const ringR = Math.min(width, height) * 0.35;

  // Partition nodes by role for seeding
  const facts = nodes.filter(n => n.role === 'fact');
  const bridges = nodes.filter(n => n.role === 'bridge');
  const dims = nodes.filter(n => n.role === 'dimension');
  const islands = nodes.filter(n =>
    n.role === 'disconnected' || n.role === 'calc-group' ||
    n.role === 'parameter'    || n.role === 'proxy' ||
    n.role === 'auto-date');

  const placeRing = (group: any[], radius: number, startAngle: number) => {
    if (group.length === 0) return;
    const step = (Math.PI * 2) / group.length;
    group.forEach((n, i) => {
      const saved = erdNodePositions[n.id];
      if (saved) { n.x = saved.x; n.y = saved.y; return; }
      const a = startAngle + i * step;
      n.x = cx + Math.cos(a) * radius;
      n.y = cy + Math.sin(a) * radius;
    });
  };

  placeRing(facts,   facts.length > 1 ? 120 : 0, -Math.PI / 2);
  placeRing(bridges, ringR * 0.6, Math.PI / 4);
  placeRing(dims,    ringR * 1.15, 0);

  // Islands off in a column on the right — force repulsion will
  // still nudge them apart but they start far from the main graph.
  islands.forEach((n, i) => {
    const saved = erdNodePositions[n.id];
    if (saved) { n.x = saved.x; n.y = saved.y; return; }
    n.x = cx + ringR * 1.8 + (i % 2) * 120;
    n.y = cy - ringR * 0.8 + Math.floor(i / 2) * 70;
  });

  if (nodes.length < 2) return;

  const nodeMap = new Map<string, any>(nodes.map(n => [n.id, n]));
  // Tuned for readability over raw physics fidelity:
  //   - Longer spring length spreads clusters so labels don't overlap
  //   - Stronger spring K pulls connected tables into tight clusters
  //   - Gravity (weak central pull) keeps the whole diagram from drifting
  //   - Role affinity is left to the seeded placement above
  const STEPS = 400;
  const REPULSION = 22000;
  const SPRING_LEN = 220;
  const SPRING_K = 0.08;
  const GRAVITY = 0.015;
  const DAMP = 0.82;
  const MAX_VEL = 60;
  // Node-overlap avoidance: during the cooling phase we push nodes
  // apart if their bounding boxes would overlap. Applied after the
  // regular physics each step so it takes priority over spring pulls.
  const OVERLAP_PAD = 16;

  for (let step = 0; step < STEPS; step++) {
    const temp = 1 - step / STEPS;
    for (const n of nodes) { n._fx = 0; n._fy = 0; }

    // Pairwise repulsion — O(n²). ~50 nodes → 1225 pairs/step × 400 = 490k ops.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a._fx += fx; a._fy += fy;
        b._fx -= fx; b._fy -= fy;
      }
    }

    // Spring attraction along edges
    for (const e of edges) {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const disp = dist - SPRING_LEN;
      const fx = (dx / dist) * disp * SPRING_K;
      const fy = (dy / dist) * disp * SPRING_K;
      a._fx += fx; a._fy += fy;
      b._fx -= fx; b._fy -= fy;
    }

    // Gravity — gentle pull toward the canvas centre so the graph
    // doesn't drift off-screen after many iterations.
    for (const n of nodes) {
      n._fx += (cx - n.x) * GRAVITY;
      n._fy += (cy - n.y) * GRAVITY;
    }

    // Integrate with damping + cooling
    for (const n of nodes) {
      n.vx = (n.vx + n._fx) * DAMP;
      n.vy = (n.vy + n._fy) * DAMP;
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > MAX_VEL) {
        n.vx = (n.vx / speed) * MAX_VEL;
        n.vy = (n.vy / speed) * MAX_VEL;
      }
      n.x += n.vx * temp;
      n.y += n.vy * temp;
    }
  }

  // Overlap resolution pass — a couple of additional sweeps without
  // the rest of the physics. Pushes apart any pair whose rectangles
  // are still touching after the main simulation.
  for (let sweep = 0; sweep < 6; sweep++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const minDx = (a.w + b.w) / 2 + OVERLAP_PAD;
        const minDy = (a.h + b.h) / 2 + OVERLAP_PAD;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // Push apart along the smaller overlap axis (cheaper move).
          if (overlapX < overlapY) {
            const shift = (overlapX / 2) * (dx >= 0 ? 1 : -1);
            a.x += shift; b.x -= shift;
          } else {
            const shift = (overlapY / 2) * (dy >= 0 ? 1 : -1);
            a.y += shift; b.y -= shift;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function erdControls(nodes: any[], edges: any[]): string {
  const on = (k: string) => (erdFilters as any)[k] ? ' active' : '';
  return `<div class="erd-controls">
    <div class="erd-toggles">
      <button class="filter-btn${on('calcGroups')}" data-action="erd-toggle" data-filter="calcGroups" title="Show calc group tables">Calc groups</button>
      <button class="filter-btn${on('fieldParams')}" data-action="erd-toggle" data-filter="fieldParams" title="Show field-parameter tables">Field params</button>
      <button class="filter-btn${on('proxies')}" data-action="erd-toggle" data-filter="proxies" title="Show composite-model proxy tables">Proxies</button>
      <button class="filter-btn${on('autoDate')}" data-action="erd-toggle" data-filter="autoDate" title="Show LocalDateTable_* / DateTableTemplate_* infrastructure">Auto-date</button>
    </div>
    <div class="erd-actions">
      <button class="filter-btn" data-action="erd-reset" title="Reset layout + viewport">Reset layout</button>
      <button class="filter-btn" data-action="erd-fit" title="Fit diagram to screen">Fit</button>
    </div>
  </div>`;
}

function erdLegend(): string {
  const roles: [string, string][] = [
    ['fact', 'Fact'], ['dimension', 'Dimension'], ['bridge', 'Bridge'],
    ['disconnected', 'Disconnected'], ['calc-group', 'Calc group'],
    ['parameter', 'Field parameter'], ['proxy', 'Composite proxy'],
    ['auto-date', 'Auto-date'],
  ];
  const chips = roles.map(([r, label]) =>
    `<span class="erd-legend-chip erd-role-${r}"><span class="erd-legend-swatch"></span>${label}</span>`
  ).join('');
  return `<div class="erd-legend">${chips}
    <span class="erd-legend-sep">|</span>
    <span class="erd-legend-chip"><span class="erd-legend-line"></span>Active</span>
    <span class="erd-legend-chip"><span class="erd-legend-line erd-legend-line--dashed"></span>Inactive</span>
  </div>`;
}

function erdFooter(nodes: any[], edges: any[]): string {
  const activeEdges = edges.filter((e: any) => e.active).length;
  const inactiveEdges = edges.length - activeEdges;
  const meta = nodes.length + ' table' + (nodes.length === 1 ? '' : 's') +
    ' · ' + edges.length + ' relationship' + (edges.length === 1 ? '' : 's') +
    (inactiveEdges ? ' (' + activeEdges + ' active, ' + inactiveEdges + ' inactive)' : '');
  return '<div class="panel-footer"><div class="left">' + meta +
    '</div><div class="right" style="color:var(--text-faint);font-size:11px">Drag background to pan · wheel to zoom · drag a node to move · click to open</div></div>';
}

function renderErd() {
  const el = document.getElementById('erd-content');
  if (!el) return;

  const { nodes, edges } = erdBuildGraph();

  if (nodes.length === 0) {
    el.innerHTML = erdControls(nodes, edges) +
      '<div style="text-align:center;padding:80px 20px;color:var(--text-faint);font-size:13px">No tables match the current filters.</div>' +
      erdLegend() + erdFooter(nodes, edges);
    return;
  }

  const W = 1200, H = 700;
  erdLayout(nodes, edges, W, H);

  // Persist positions for next render
  for (const n of nodes) {
    erdNodePositions[n.id] = { x: n.x, y: n.y };
    erdNodeSizes[n.id]     = { w: n.w, h: n.h };
  }

  // Bounding box + viewBox padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 120;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const vbW = Math.max(maxX - minX, 600);
  const vbH = Math.max(maxY - minY, 400);

  const nodeMap = new Map<string, any>(nodes.map(n => [n.id, n]));

  // Edges anchor to the node's BORDER (not its centre) via
  // erdEdgeAnchor — otherwise the line runs through the node's body
  // and the arrowhead hides inside the target box.
  const edgeMarkup = edges.map((e: any) => {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) return '';
    const aEdge = erdEdgeAnchor(a.x, a.y, a.w, a.h, b.x, b.y);
    const bEdge = erdEdgeAnchor(b.x, b.y, b.w, b.h, a.x, a.y);
    const cls = 'erd-edge erd-edge--' + (e.active ? 'active' : 'inactive');
    return `<g class="${cls}" data-edge="${escAttr(e.from + '->' + e.to)}">
      <line x1="${aEdge.x}" y1="${aEdge.y}" x2="${bEdge.x}" y2="${bEdge.y}"
        marker-end="url(#erd-arrow-${e.active ? 'active' : 'inactive'})" />
      <circle cx="${aEdge.x}" cy="${aEdge.y}" r="3" />
    </g>`;
  }).join('');

  const nodeMarkup = nodes.map((n: any) => {
    const w = n.w, h = n.h;
    const sub = (n.columnCount || 0) + 'c' + (n.measureCount > 0 ? ' · ' + n.measureCount + 'ƒ' : '');
    return `<g class="erd-node erd-role-${n.role}" data-node="${escAttr(n.id)}"
      transform="translate(${n.x - w/2},${n.y - h/2})">
      <rect class="erd-node-rect" width="${w}" height="${h}" rx="5" ry="5" />
      <text class="erd-node-name" x="${w/2}" y="17" text-anchor="middle">${escHtml(n.name)}</text>
      <text class="erd-node-sub" x="${w/2}" y="31" text-anchor="middle">${escHtml(sub)}</text>
    </g>`;
  }).join('');

  const controls = erdControls(nodes, edges);
  const legend = erdLegend();
  const footer = erdFooter(nodes, edges);

  el.innerHTML = controls +
    `<div class="erd-wrap">
      <svg id="erd-svg" viewBox="${minX} ${minY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="erd-arrow-active" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="erd-arrow-head erd-arrow-head--active"/>
          </marker>
          <marker id="erd-arrow-inactive" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="erd-arrow-head erd-arrow-head--inactive"/>
          </marker>
        </defs>
        <g id="erd-view" transform="translate(${erdView.tx} ${erdView.ty}) scale(${erdView.scale})">
          <g id="erd-edges">${edgeMarkup}</g>
          <g id="erd-nodes">${nodeMarkup}</g>
        </g>
      </svg>
    </div>` + legend + footer;

  erdAttachInteractions(minX, minY, vbW, vbH);
}

// Interaction state — module-level so the various handlers share it.
var erdInteraction = {
  panning: false as boolean,
  panStart: { x: 0, y: 0 },
  panStartTf: { tx: 0, ty: 0 },
  dragNode: null as (SVGGElement | null),
  dragStart: { x: 0, y: 0 },
  dragNodeStart: { x: 0, y: 0 },
  dragMoved: false,
  // viewBox dimensions so we can convert screen deltas → SVG coords
  vbMinX: 0, vbMinY: 0, vbW: 0, vbH: 0,
};

function erdSvgCoords(ev: MouseEvent, svg: SVGSVGElement): {x:number,y:number} {
  const rect = svg.getBoundingClientRect();
  const scaleX = erdInteraction.vbW / rect.width;
  const scaleY = erdInteraction.vbH / rect.height;
  return {
    x: erdInteraction.vbMinX + (ev.clientX - rect.left) * scaleX,
    y: erdInteraction.vbMinY + (ev.clientY - rect.top) * scaleY,
  };
}

function erdApplyViewTransform() {
  const view = document.getElementById('erd-view');
  if (!view) return;
  view.setAttribute('transform',
    'translate(' + erdView.tx + ' ' + erdView.ty + ') scale(' + erdView.scale + ')');
}

function erdAttachInteractions(minX: number, minY: number, vbW: number, vbH: number) {
  erdInteraction.vbMinX = minX;
  erdInteraction.vbMinY = minY;
  erdInteraction.vbW = vbW;
  erdInteraction.vbH = vbH;

  const svg = document.getElementById('erd-svg') as unknown as SVGSVGElement | null;
  if (!svg) return;

  // Background mousedown → start pan. Node mousedown → start drag.
  svg.addEventListener('mousedown', (ev: MouseEvent) => {
    const target = ev.target as Element;
    const nodeG = target.closest('.erd-node') as SVGGElement | null;
    if (nodeG) {
      ev.preventDefault();
      erdInteraction.dragNode = nodeG;
      erdInteraction.dragStart = erdSvgCoords(ev, svg);
      const id = nodeG.getAttribute('data-node') || '';
      const pos = erdNodePositions[id] || { x: 0, y: 0 };
      erdInteraction.dragNodeStart = { x: pos.x, y: pos.y };
      erdInteraction.dragMoved = false;
    } else {
      erdInteraction.panning = true;
      erdInteraction.panStart = { x: ev.clientX, y: ev.clientY };
      erdInteraction.panStartTf = { tx: erdView.tx, ty: erdView.ty };
    }
  });

  // Global mousemove + mouseup so drags continue beyond the SVG frame.
  const onMove = (ev: MouseEvent) => {
    if (erdInteraction.dragNode) {
      const coords = erdSvgCoords(ev, svg);
      const dx = coords.x - erdInteraction.dragStart.x;
      const dy = coords.y - erdInteraction.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) erdInteraction.dragMoved = true;
      const nx = erdInteraction.dragNodeStart.x + dx;
      const ny = erdInteraction.dragNodeStart.y + dy;
      const id = erdInteraction.dragNode.getAttribute('data-node') || '';
      erdNodePositions[id] = { x: nx, y: ny };
      // Update transform in-place — no need to re-render the whole SVG.
      const rect = erdInteraction.dragNode.querySelector('rect');
      const w = rect ? parseFloat(rect.getAttribute('width') || '110') : 110;
      const h = rect ? parseFloat(rect.getAttribute('height') || '40') : 40;
      erdInteraction.dragNode.setAttribute('transform',
        'translate(' + (nx - w/2) + ' ' + (ny - h/2) + ')');
      // Update any edges that touch this node
      erdUpdateEdgesFor(id, nx, ny);
    } else if (erdInteraction.panning) {
      const dx = ev.clientX - erdInteraction.panStart.x;
      const dy = ev.clientY - erdInteraction.panStart.y;
      // Convert screen delta → SVG coords (viewBox units) to match zoom
      const rect = svg.getBoundingClientRect();
      const sx = erdInteraction.vbW / rect.width;
      const sy = erdInteraction.vbH / rect.height;
      erdView.tx = erdInteraction.panStartTf.tx + dx * sx;
      erdView.ty = erdInteraction.panStartTf.ty + dy * sy;
      erdApplyViewTransform();
    }
  };
  const onUp = () => {
    erdInteraction.dragNode = null;
    erdInteraction.panning = false;
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Zoom on wheel — centred on the cursor position so zoom feels natural.
  svg.addEventListener('wheel', (ev: WheelEvent) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.2, Math.min(4, erdView.scale * factor));
    // Zoom towards the mouse position
    const pt = erdSvgCoords(ev, svg);
    erdView.tx = (erdView.tx - pt.x) * (newScale / erdView.scale) + pt.x;
    erdView.ty = (erdView.ty - pt.y) * (newScale / erdView.scale) + pt.y;
    erdView.scale = newScale;
    erdApplyViewTransform();
  }, { passive: false });

  // Click on a node → open its card on the Tables tab (unless we just
  // dragged the node — the `dragMoved` guard avoids firing a click after
  // a drag gesture).
  svg.addEventListener('click', (ev: MouseEvent) => {
    const target = ev.target as Element;
    const nodeG = target.closest('.erd-node') as SVGGElement | null;
    if (!nodeG || erdInteraction.dragMoved) return;
    const id = nodeG.getAttribute('data-node');
    if (!id) return;
    // Open the table's card
    openTables.add(id);
    switchTab('tables');
    renderTables();
    // Scroll the card into view
    setTimeout(() => {
      const cards = document.querySelectorAll('.page-card .page-name');
      for (const c of cards as unknown as HTMLElement[]) {
        if (c.textContent && c.textContent.trim() === id) {
          c.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }, 50);
  });
}

/** After dragging a node, update every edge that touches it in-place
 *  instead of re-rendering the whole SVG. Keeps drag smooth. Both
 *  endpoints are recomputed via erdEdgeAnchor so the line stays on
 *  the rectangle borders (not the centres) even after drag. */
function erdUpdateEdgesFor(nodeId: string, nx: number, ny: number) {
  const draggedSize = erdNodeSizes[nodeId] || { w: 110, h: ERD_NODE_H };
  const edges = document.querySelectorAll('.erd-edge');
  for (const e of edges as unknown as SVGGElement[]) {
    const edgeId = e.getAttribute('data-edge') || '';
    const [from, to] = edgeId.split('->');
    if (from !== nodeId && to !== nodeId) continue;
    const line = e.querySelector('line');
    const dot = e.querySelector('circle');
    if (!line) continue;
    // The *other* endpoint — its position hasn't moved, but its
    // anchor point needs recomputing against the dragged node's new
    // centre (the ray direction changed).
    const otherId = from === nodeId ? to : from;
    const otherPos = erdNodePositions[otherId];
    const otherSize = erdNodeSizes[otherId];
    if (!otherPos || !otherSize) continue;
    // Dragged node's anchor — ray from (nx,ny) toward the other node
    const draggedAnchor = erdEdgeAnchor(nx, ny, draggedSize.w, draggedSize.h, otherPos.x, otherPos.y);
    // Other node's anchor — ray from its centre toward the dragged node
    const otherAnchor = erdEdgeAnchor(otherPos.x, otherPos.y, otherSize.w, otherSize.h, nx, ny);
    const fromAnchor = from === nodeId ? draggedAnchor : otherAnchor;
    const toAnchor   = to   === nodeId ? draggedAnchor : otherAnchor;
    line.setAttribute('x1', String(fromAnchor.x));
    line.setAttribute('y1', String(fromAnchor.y));
    line.setAttribute('x2', String(toAnchor.x));
    line.setAttribute('y2', String(toAnchor.y));
    if (dot) {
      dot.setAttribute('cx', String(fromAnchor.x));
      dot.setAttribute('cy', String(fromAnchor.y));
    }
  }
}

function toggleErdFilter(filter: string) {
  const key = filter as keyof typeof erdFilters;
  erdFilters[key] = !erdFilters[key];
  renderErd();
}

function resetErdLayout() {
  erdNodePositions = {};
  erdView = { tx: 0, ty: 0, scale: 1 };
  renderErd();
}

function fitErdView() {
  erdView = { tx: 0, ty: 0, scale: 1 };
  erdApplyViewTransform();
}

function renderFunctions(){
  const fns=DATA.functions.filter(f=>!f.name.endsWith('.About'));
  var fnsFooter='<div class="panel-footer"><div class="left">'+fns.length+' function'+(fns.length===1?'':'s')+'</div></div>';
  if(!fns.length){document.getElementById("functions-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No user-defined functions found in the model</div>'+fnsFooter;return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const f of fns){
    const refMeasures=DATA.measures.filter(m=>m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'('));
    const params=f.parameters?f.parameters.split(',').map(p=>{
      const parts=p.trim().split(/\s*:\s*/);
      return parts.length>=2?'<span style="color:var(--code-name)">'+parts[0].trim()+'</span> <span style="color:var(--code-punct)">:</span> <span style="color:var(--code-type)">'+parts.slice(1).join(':').trim()+'</span>':'<span style="color:var(--code-name)">'+p.trim()+'</span>';
    }).join('<span style="color:var(--code-punct)">, </span>'):'<span style="color:var(--code-punct);font-style:italic">none</span>';
    const desc=f.description?'<div style="font-size:11px;color:#64748B;margin-top:6px;line-height:1.4">'+f.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    const expr=f.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const measureChips=refMeasures.map(m=>`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>`).join('');
    h+=`<div class="page-card">
      <div class="page-header" data-action="card-toggle">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">${escHtml(f.name)}</div>
          <div style="font-size:11px;color:#64748B;margin-top:2px;font-family:'JetBrains Mono',monospace">( ${params} )</div>
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${refMeasures.length}</div><div class="page-stat-label">Measures</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        ${desc}
        ${refMeasures.length?`<div style="margin-top:8px"><div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px">Measures using this function</div><div style="display:flex;flex-wrap:wrap;gap:4px">${measureChips}</div></div>`:''}
        <div class="lineage-dax" style="margin-top:8px;max-height:300px;overflow-y:auto">${expr}</div>
      </div></div>
    </div>`;
  }
  h+='</div>'+fnsFooter;
  document.getElementById("functions-content").innerHTML=h;
}

function renderCalcGroups(){
  const cgs=DATA.calcGroups;
  var cgsFooter='<div class="panel-footer"><div class="left">'+cgs.length+' calc group'+(cgs.length===1?'':'s')+'</div></div>';
  if(!cgs.length){document.getElementById("calcgroups-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No calculation groups found in the model</div>'+cgsFooter;return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const cg of cgs){
    const desc=cg.description?'<div style="font-size:11px;color:var(--text-dim);margin-top:4px">'+cg.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    let items='';
    for(const item of cg.items){
      const expr=item.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const fmtBadge=item.formatStringExpression?'<span class="mono" style="margin-left:8px;font-size:10px;color:var(--text-dim)">fmt: '+item.formatStringExpression.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>':'';
      const itemDesc=item.description?'<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">'+item.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
      items+=`<div class="ci-card">
        <div class="ci-head">
          <span class="ci-ord">${item.ordinal}</span>
          <span class="ci-name">${item.name}</span>${fmtBadge}
        </div>${itemDesc}
        <div class="lineage-dax" style="font-size:12px">${expr}</div>
      </div>`;
    }
    h+=`<div class="page-card">
      <div class="page-header" data-action="card-toggle">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">${escHtml(cg.name)}</div>
          ${desc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-upstream)">${cg.items.length}</div><div class="page-stat-label">Items</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#64748B">${cg.precedence}</div><div class="page-stat-label">Precedence</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">${items}</div></div>
    </div>`;
  }
  h+='</div>'+cgsFooter;
  document.getElementById("calcgroups-content").innerHTML=h;
}

function sortTable(t,k){const s=sortState[t];if(s.key===k)s.desc=!s.desc;else{s.key=k;s.desc=true;}t==="measures"?renderMeasures():renderColumns();}
function filterTable(t,v){searchTerms[t]=v;t==="measures"?renderMeasures():renderColumns();}
function toggleUnused(t){showUnusedOnly[t]=!showUnusedOnly[t];document.getElementById("btn-unused-"+(t==="measures"?"m":"c")).classList.toggle("active");t==="measures"?renderMeasures():renderColumns();}

function currentMd(){
  switch(activeMd){
    case "datadict":   return MARKDOWN_DATADICT;
    case "measures":   return MARKDOWN_MEASURES;
    case "functions":  return MARKDOWN_FUNCTIONS;
    case "calcgroups": return MARKDOWN_CALCGROUPS;
    case "quality":    return MARKDOWN_QUALITY;
    default:           return MARKDOWN;
  }
}
function currentMdFilename(){
  var suffix="-semantic-model.md";
  if(activeMd==="datadict")        suffix="-data-dictionary.md";
  else if(activeMd==="measures")   suffix="-measures.md";
  else if(activeMd==="functions")  suffix="-functions.md";
  else if(activeMd==="calcgroups") suffix="-calculation-groups.md";
  else if(activeMd==="quality")    suffix="-data-quality.md";
  return REPORT_NAME+suffix;
}

function switchMd(which){
  activeMd=which;
  var ids=["model","datadict","measures","functions","calcgroups","quality"];
  ids.forEach(function(id){
    var el=document.getElementById("md-tab-"+id);
    if(el)el.classList.toggle("active",which===id);
  });
  var sub=document.getElementById("md-subtitle");
  if(sub){
    if(which==="datadict")        sub.textContent="Data dictionary reference \u00b7 per-table columns, constraints, hierarchies (no DAX expressions)";
    else if(which==="measures")   sub.textContent="Measures reference \u00b7 A\u2013Z alphabetical (no DAX expressions)";
    else if(which==="functions")  sub.textContent="Functions reference \u00b7 per-UDF parameters, descriptions and bodies";
    else if(which==="calcgroups") sub.textContent="Calculation groups reference \u00b7 per-item descriptions and bodies";
    else if(which==="quality")    sub.textContent="Data quality review \u00b7 coverage, removal candidates, indirect entities, inactive relationships";
    else                          sub.textContent="Semantic-model documentation (no DAX expressions)";
  }
  renderDocs();
}

function switchMdMode(mode){
  mdViewMode=mode;
  var rb=document.getElementById("md-mode-rendered");
  var wb=document.getElementById("md-mode-raw");
  if(rb)rb.classList.toggle("active",mode==="rendered");
  if(wb)wb.classList.toggle("active",mode==="raw");
  var rendered=document.getElementById("md-rendered");
  var source=document.getElementById("md-source");
  if(rendered)rendered.style.display=mode==="rendered"?"":"none";
  if(source)source.style.display=mode==="raw"?"":"none";
  renderDocs();
}

function expandAllDetails(){
  var host=document.getElementById("md-rendered");
  if(!host)return;
  host.querySelectorAll("details").forEach(function(d){d.open=true;});
}
function collapseAllDetails(){
  var host=document.getElementById("md-rendered");
  if(!host)return;
  host.querySelectorAll("details").forEach(function(d){d.open=false;});
}

// ─── Markdown renderer ────────────────────────────────────────────────────
// The mdEscapeHtml / mdInline / mdParseTable / mdRender quartet lives in
// src/client/render/md.ts now (Stop 5 pass 2). That file is a separate
// TypeScript SCRIPT (no imports, no exports) that gets compiled next to
// this one and concatenated into the same inline <script> block by the
// server-side generator. The symbols are therefore visible at runtime as
// top-level globals, same as if they were still inline here.

function renderDocs(){
  var src=document.getElementById("md-source");
  var rendered=document.getElementById("md-rendered");
  var md=currentMd();
  if(src)src.textContent=md;
  if(rendered){
    rendered.innerHTML=mdRender(md)+
      '<hr style="border:none;border-top:1px dashed var(--border-soft);margin:18px 0 10px">'+
      '<div style="font:11px/1.5 \'JetBrains Mono\',monospace;color:var(--text-faint);text-align:center">'+
        'Generated by Power BI Lineage v'+APP_VERSION+' · '+GENERATED_AT+' · '+escHtml(REPORT_NAME)+
      '</div>';
    // Colourise any ```dax fenced blocks that mdRender produced —
    // they land as <pre><code class="language-dax"> which the
    // highlighter targets by default.
    highlightDaxBlocks();
  }
  // Docs panel footer (outside .md-rendered) shows line / char totals.
  var lineCount=md?md.split(/\r?\n/).length:0;
  setPanelFooter("footer-docs",
    lineCount+' lines · generated '+GENERATED_AT,
    (md?md.length:0)+' chars');
}

function copyMarkdown(){
  var btn=document.getElementById("md-copy-btn");
  var text=currentMd();
  function ok(){if(btn){btn.textContent="✓ Copied";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}}
  function fallback(){
    var ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
    var ok2=false;try{ok2=document.execCommand("copy");}catch(e){}
    document.body.removeChild(ta);
    if(ok2)ok();else if(btn){btn.textContent="✗ Failed";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(ok).catch(fallback);
  }else{fallback();}
}

function downloadMarkdown(){
  var text=currentMd();
  var blob=new Blob([text],{type:"text/markdown;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;a.download=currentMdFilename();
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

renderSummary();renderTabs();renderMeasures();renderColumns();renderTables();renderRelationships();renderSources();renderErd();renderFunctions();renderCalcGroups();renderPages();renderUnused();renderDocs();switchTab("erd");addCopyButtons();
