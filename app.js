const DB='ExpenseTrackerV2',STORE='expenses',CATS=['Fuel','Groceries / Food','Office Supplies','Business Supplies','Equipment','Vehicle','Advertising','Professional Services','Utilities','Travel','Repairs & Maintenance','Other'];let db,current=null,googleToken=null,tokenClient=null,gapiReady=false;const $=x=>document.getElementById(x),money=x=>Number(x||0).toLocaleString('en-CA',{style:'currency',currency:'CAD'}),today=()=>new Date().toISOString().slice(0,10),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function openDB(){return new Promise((ok,no)=>{let r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>{db=r.result;ok()};r.onerror=()=>no(r.error)})}function all(){return new Promise(ok=>{let r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>ok(r.result.sort((a,b)=>(b.date||'').localeCompare(a.date||'')))})}function put(x){return new Promise(ok=>{let r=db.transaction(STORE,'readwrite').objectStore(STORE).put(x);r.onsuccess=ok})}function remove(id){return new Promise(ok=>{let r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=ok})}
function show(id){document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));if(id==='home')dashboard();if(id==='expenses')renderList();if(id==='reports')reports()}
function extract(t){
  const text = String(t || '').replace(/\s+/g, ' ').trim();
  const upper = text.toUpperCase();

  // ---------- Supplier ----------
  let supplier = '';

  const suppliers = [
    { match: /HOME\s*DEPOT|HOMEDEPOT\.COM/i, name: 'Home Depot' },
    { match: /\bRONA\b/i, name: 'Rona' },
    { match: /\bCANADIAN\s*TIRE\b/i, name: 'Canadian Tire' },
    { match: /\bSTAPLES\b/i, name: 'Staples' },
    { match: /\bCOSTCO\b/i, name: 'Costco' },
    { match: /\bWALMART\b/i, name: 'Walmart' },
    { match: /\bSHELL\b/i, name: 'Shell' },
    { match: /\bESSO\b/i, name: 'Esso' },
    { match: /PETRO[\s-]*CANADA/i, name: 'Petro-Canada' }
  ];

  for (const s of suppliers) {
    if (s.match.test(text)) {
      supplier = s.name;
      break;
    }
  }

  if (!supplier) {
    const lines = String(t || '')
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);

    supplier = lines.find(x =>
      /[A-Za-z]{3}/.test(x) &&
      !/^\d+\s/.test(x)
    ) || '';
  }

  // ---------- Money helper ----------
  function amount(labelRegex) {
    const m = text.match(labelRegex);
    if (!m) return 0;

    return Math.round(
      Number(m[1].replace(/,/g, '')) * 100
    ) / 100;
  }

  // ---------- Receipt amounts ----------
  const subtotal = amount(
    /\bSUB\s*TOTAL\b\s*:?\s*\$?\s*([0-9,]+\.\d{2})/i
  );

  const gst = amount(
    /\bGST(?:\/HST)?\b\s*:?\s*\$?\s*([0-9,]+\.\d{2})/i
  );

  const pst = amount(
    /\b(?:PST|PST\/QST|QST)\b\s*:?\s*\$?\s*([0-9,]+\.\d{2})/i
  );

  let total = amount(
    /\bTOTAL\b\s*:?\s*\$?\s*([0-9,]+\.\d{2})/i
  );

  // Avoid using payment-card TOTAL occurrences if the labelled
  // receipt total wasn't found.
  if (!total && subtotal) {
    total = Math.round((subtotal + gst + pst) * 100) / 100;
  }

  const tax = Math.round((gst + pst) * 100) / 100;

  // ---------- Date ----------
  let date = today();

  // Canadian receipt format: DD/MM/YYYY or DD/MM/YY
  let dm = text.match(
    /\b([0-3]?\d)\/([01]?\d)\/(\d{2,4})\b/
  );

  if (dm) {
    let year = dm[3];

    if (year.length === 2) {
      year = '20' + year;
    }

    date =
      year + '-' +
      dm[2].padStart(2, '0') + '-' +
      dm[1].padStart(2, '0');
  } else {
    dm = text.match(
      /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/
    );

    if (dm) {
      date =
        dm[1] + '-' +
        dm[2].padStart(2, '0') + '-' +
        dm[3].padStart(2, '0');
    }
  }

  // ---------- Invoice / receipt number ----------
  const inv =
    text.match(
      /(?:INVOICE|RECEIPT|INV)\s*#?\s*:?\s*([A-Z0-9-]+)/i
    );

  const invoice = inv ? inv[1] : '';

  // ---------- Payment ----------
  let payment = '';

  const card = text.match(
    /X{4,}(\d{4})\s+(VISA|MASTERCARD|MC|AMEX)/i
  );

  if (card) {
    let brand = card[2].toUpperCase();

    if (brand === 'MC') brand = 'Mastercard';
    else if (brand === 'VISA') brand = 'Visa';
    else if (brand === 'AMEX') brand = 'Amex';

    payment = brand + ' •••• ' + card[1];
  }

  // ---------- Category ----------
  let category = 'Other';

  const q = supplier.toLowerCase();

  if (
    q.includes('shell') ||
    q.includes('esso') ||
    q.includes('petro-canada')
  ) {
    category = 'Fuel';
  } else if (q.includes('staples')) {
    category = 'Office Supplies';
  } else if (
    q.includes('home depot') ||
    q.includes('rona')
  ) {
    category = 'Business Supplies';
  } else if (q.includes('canadian tire')) {
    category = 'Vehicle';
  }

  // ---------- Validation ----------
  let notes = '';

  if (subtotal && total) {
    const calculated =
      Math.round((subtotal + gst + pst) * 100) / 100;

    if (Math.abs(calculated - total) > 0.02) {
      notes =
        'CHECK TOTAL: subtotal + taxes = $' +
        calculated.toFixed(2) +
        ', receipt total = $' +
        total.toFixed(2);
    }
  }

  return {
    supplier,
    date,
    invoice,
    category,
    subtotal,
    tax,
    gst,
    pst,
    total,
    payment,
    notes,
    ocr: t
  };
}
async function imageOCR(file){$('processing').classList.remove('hidden');try{let r=await Tesseract.recognize(file,'eng',{logger:m=>{if(m.status==='recognizing text')$('progress').textContent=Math.round(m.progress*100)+'%'}});current={id:crypto.randomUUID(),createdAt:new Date().toISOString(),...extract(r.data.text)};review()}finally{$('processing').classList.add('hidden')}}
async function pdfRead(blob,name){$('processing').classList.remove('hidden');try{let p=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');p.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';let pdf=await p.getDocument({data:await blob.arrayBuffer()}).promise,text='';for(let i=1;i<=pdf.numPages;i++){let pg=await pdf.getPage(i),c=await pg.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n';$('progress').textContent=`page ${i}/${pdf.numPages}`}current={id:crypto.randomUUID(),createdAt:new Date().toISOString(),fileName:name,...extract(text)};review()}catch(e){alert('Could not read PDF: '+e.message)}finally{$('processing').classList.add('hidden')}}
function review(){for(let k of ['supplier','date','invoice','category','subtotal','gst','pst','total','payment','notes'])$(k).value=current[k]??'';$('ocr').textContent=current.ocr||'';show('review')}
function card(x){return `<button class="card" onclick="edit('${x.id}')"><div class="row"><b>${esc(x.supplier||'Unknown supplier')}</b><b>${money(x.total)}</b></div><div class="muted">${esc(x.date)} · ${esc(x.invoice||'No invoice #')}</div><span class="tag">${esc(x.category)}</span></button>`}
async function dashboard(){
  let x=await all();

  const currentYear=new Date().getFullYear();
  const previousYear=currentYear-1;

  function yearTotals(year){
    const receipts=x.filter(a=>(a.date||'').startsWith(String(year)));

    const total=receipts.reduce((s,a)=>s+(+a.total||0),0);
    const gst=receipts.reduce((s,a)=>s+(+a.gst||0),0);
    const pst=receipts.reduce((s,a)=>s+(+a.pst||0),0);

    return{
      year,
      total,
      gst,
      pst,
      tax:gst+pst,
      count:receipts.length
    };
  }

  const current=yearTotals(currentYear);
  const previous=yearTotals(previousYear);
const archivedYears=[...new Set(
  x.map(a=>parseInt((a.date||'').slice(0,4)))
   .filter(y=>Number.isFinite(y)&&y<previousYear)
)].sort((a,b)=>b-a);

$('archives').innerHTML=archivedYears.length
  ? archivedYears.map(year=>{
      const a=yearTotals(year);
      return `<button class="panel" style="width:100%;text-align:left" onclick="openArchive(${year})">
        <h3>${year}</h3>
        <div class="stats">
          <div><small>Total Expenses</small><b>${money(a.total)}</b></div>
          <div><small>GST/HST</small><b>${money(a.gst)}</b></div>
          <div><small>PST/QST</small><b>${money(a.pst)}</b></div>
          <div><small>Total Tax</small><b>${money(a.tax)}</b></div>
          <div><small>Receipts</small><b>${a.count}</b></div>
        </div>
      </button>`;
    }).join('')
  : '<div class="panel">No archived years yet.</div>';  

 $('currentYearLabel').textContent=currentYear+' — Current Year';
$('mTotal').textContent=money(current.total);
$('mGST').textContent=money(current.gst);
$('mPST').textContent=money(current.pst);
$('mTax').textContent=money(current.tax);
$('mCount').textContent=current.count;

$('previousYearLabel').textContent=previousYear+' — Previous Year';
$('pTotal').textContent=money(previous.total);
$('pGST').textContent=money(previous.gst);
$('pPST').textContent=money(previous.pst);
$('pTax').textContent=money(previous.tax);
$('pCount').textContent=previous.count;
  $('recent').innerHTML=x.slice(0,8).map(card).join('')||
    '<div class="panel">No expenses yet.</div>';
}
  async function openArchive(year){
  const x=await all();
  const receipts=x.filter(a=>(a.date||'').startsWith(String(year)));

  const total=receipts.reduce((s,a)=>s+(+a.total||0),0);
  const gst=receipts.reduce((s,a)=>s+(+a.gst||0),0);
  const pst=receipts.reduce((s,a)=>s+(+a.pst||0),0);
  const tax=gst+pst;

  $('archiveTitle').textContent=year+' — Archived Year';
  $('aTotal').textContent=money(total);
  $('aGST').textContent=money(gst);
  $('aPST').textContent=money(pst);
  $('aTax').textContent=money(tax);
  $('aCount').textContent=receipts.length;

  $('archiveReceipts').innerHTML=
    receipts.map(card).join('')||
    '<div class="panel">No receipts for this year.</div>';

  show('archiveDetail');
}
async function renderList(){let q=$('search').value.toLowerCase(),x=(await all()).filter(a=>!q||JSON.stringify(a).toLowerCase().includes(q));$('list').innerHTML=x.map(card).join('')}async function edit(id){current=(await all()).find(x=>x.id===id);review()}async function reports(){let x=await all(),groups={};x.forEach(a=>groups[a.category]=(groups[a.category]||0)+(+a.total||0));$('report').innerHTML=`<div class="panel"><b>Total ${money(x.reduce((s,a)=>s+(+a.total||0),0))}</b><p>Tax ${money(x.reduce((s,a)=>s+(+a.tax||0),0))}</p></div>`+Object.entries(groups).sort((a,b)=>b[1]-a[1]).map(x=>`<div class="card row"><span>${esc(x[0])}</span><b>${money(x[1])}</b></div>`).join('')}
const SCOPES='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file';async function ginit(){if(!window.GOOGLE_CONFIG||GOOGLE_CONFIG.clientId.includes('YOUR_'))throw Error('Google is not configured yet. Follow GOOGLE_SETUP.md.');if(gapiReady)return;await new Promise((ok,no)=>gapi.load('client:picker',{callback:ok,onerror:no}));await gapi.client.init({apiKey:GOOGLE_CONFIG.apiKey,discoveryDocs:['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest','https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']});tokenClient=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CONFIG.clientId,scope:SCOPES,callback:()=>{}});gapiReady=true}async function auth(){await ginit();if(googleToken)return true;return new Promise(ok=>{tokenClient.callback=r=>{if(r.error)return ok(false);googleToken=r.access_token;gapi.client.setToken({access_token:googleToken});$('gstatus').textContent='Google connected';ok(true)};tokenClient.requestAccessToken({prompt:'consent'})})}
async function drive(){try{if(!(await auth()))return;let v=new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes('application/pdf,image/jpeg,image/png,image/webp').setMode(google.picker.DocsViewMode.LIST);new google.picker.PickerBuilder().setDeveloperKey(GOOGLE_CONFIG.apiKey).setAppId(GOOGLE_CONFIG.appId).setOAuthToken(googleToken).addView(v).setCallback(async d=>{if(d.action!==google.picker.Action.PICKED)return;for(let f of d.docs||[]){let r=await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,{headers:{Authorization:'Bearer '+googleToken}});let b=await r.blob();(f.mimeType||'').includes('pdf')?await pdfRead(b,f.name):await imageOCR(new File([b],f.name,{type:f.mimeType}))}}).build().setVisible(true)}catch(e){alert(e.message)}}function atts(p,o=[]){if(p?.filename&&p?.body?.attachmentId)o.push(p);(p?.parts||[]).forEach(x=>atts(x,o));return o}async function gmail(){try{if(!(await auth()))return;$('gmailResults').innerHTML='<div class="panel">Searching Gmail…</div>';let r=await gapi.client.gmail.users.messages.list({userId:'me',q:'has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) newer_than:2y',maxResults:25}),rows=[];for(let m of r.result.messages||[]){let f=await gapi.client.gmail.users.messages.get({userId:'me',id:m.id,format:'full'});atts(f.result.payload).forEach(p=>rows.push({mid:m.id,aid:p.body.attachmentId,name:p.filename,mime:p.mimeType}))}$('gmailResults').innerHTML=rows.map((x,i)=>`<button class="card gi" data-i="${i}"><b>${esc(x.name)}</b><div class="muted">Tap to import</div></button>`).join('')||'<div class="panel">No matching attachments.</div>';document.querySelectorAll('.gi').forEach(b=>b.onclick=()=>gimport(rows[+b.dataset.i]))}catch(e){alert('Gmail search failed: '+e.message)}}async function gimport(x){let r=await gapi.client.gmail.users.messages.attachments.get({userId:'me',messageId:x.mid,id:x.aid}),s=r.result.data.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';let raw=atob(s),u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);let b=new Blob([u],{type:x.mime});x.mime.includes('pdf')?pdfRead(b,x.name):imageOCR(new File([b],x.name,{type:x.mime}))}
function dl(n,t,s){let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s],{type:t}));a.download=n;a.click()}document.addEventListener('DOMContentLoaded',async()=>{await openDB();$('category').innerHTML=CATS.map(x=>`<option>${x}</option>`).join('');dashboard();$('camera').onchange=e=>e.target.files[0]&&imageOCR(e.target.files[0]);$('photo').onchange=e=>e.target.files[0]&&imageOCR(e.target.files[0]);$('pdf').onchange=e=>e.target.files[0]&&pdfRead(e.target.files[0],e.target.files[0].name);$('drive').onclick=drive;$('gmail').onclick=gmail;$('connect').onclick=async()=>{try{await auth()}catch(e){alert(e.message)}};$('disconnect').onclick=()=>{googleToken=null;gapi?.client?.setToken(null);$('gstatus').textContent='Not connected'};$('form').onsubmit=async e=>{e.preventDefault();for(let k of ['supplier','date','invoice','category','payment','notes'])current[k]=$(k).value;
for(let k of ['subtotal','gst','pst','total'])current[k]=+$(k).value||0;
current.tax=Math.round((current.gst+current.pst)*100)/100;
await put(current);show('home')};$('delete').onclick=async()=>{if(current&&confirm('Delete this expense?')){await remove(current.id);show('home')}};$('search').oninput=renderList;$('csv').onclick=async()=>{let x=await all(),h=['Date','Supplier','Invoice','Category','Subtotal','GST/HST','PST/QST','Total','Payment','Notes'],r=x.map(a=>[a.date,a.supplier,a.invoice,a.category,a.subtotal,a.gst||0,a.pst||0,a.total,a.payment,a.notes]);dl('expenses.csv','text/csv',[h,...r].map(z=>z.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n'))};$('backup').onclick=async()=>dl('expense-backup.json','application/json',JSON.stringify(await all(),null,2));$('restore').onchange=async e=>{let x=JSON.parse(await e.target.files[0].text());for(let a of x)await put(a);show('home')};$('install').onclick=()=>alert('On iPhone Safari: Share → Add to Home Screen.');if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js?v=5').catch(()=>{})});
