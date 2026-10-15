
(() => {
'use strict';
const $=id=>document.getElementById(id);
const STORE='pesquisa_precos_v1';
let db=loadDb(), products=[], currentKey='', sequence=[], seqPos=0, currentProductId=null; db.masterCatalog=db.masterCatalog||[];

function loadDb(){try{return JSON.parse(localStorage.getItem(STORE))||{lists:{},collections:{}}}catch(e){return {lists:{},collections:{}}}}
function saveDb(){localStorage.setItem(STORE,JSON.stringify(db));renderSaved();$('headerCount').textContent=products.length?products.length+' produtos':'Sem lista'}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function parseCSV(text){
 text=String(text||'').replace(/^\uFEFF/,'').trim(); if(!text)throw Error('O conteúdo está vazio.');
 const first=(text.split(/\r?\n/)[0]||''); const semi=(first.match(/;/g)||[]).length, tabs=(first.match(/\t/g)||[]).length, comma=(first.match(/,/g)||[]).length;
 const delim=tabs>semi&&tabs>comma?'\t':semi>=comma?';':',';
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted}
 else if(c===delim&&!quoted){row.push(field);field=''}
 else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];field=''}
 else field+=c}
 row.push(field);if(row.some(x=>x.trim()!==''))rows.push(row);
 if(rows.length<2)throw Error('Não encontrei cabeçalho e linhas de produtos.');
 const headers=rows.shift().map(x=>norm(x).replace(/[^a-z0-9]/g,''));
 return {headers,rows};
}
function money(v){if(v===null||v===undefined||String(v).trim()==='')return null;let s=String(v).trim().replace(/R\$/gi,'').replace(/\s/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?Math.round(n*100)/100:null}
// Funções auxiliares usadas pela interface e pelos botões.
function setStatus(id,msg,kind=''){const el=$(id);if(!el)return;el.className='status'+(kind?' '+kind:'');el.textContent=msg}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function brl(v){return v===null||v===undefined||v===''?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function slug(s){return String(s||'pesquisa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}
function csvCell(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
function download(name,content,type='text/csv;charset=utf-8;'){const blob=new Blob([type.includes('json')?'': '\uFEFF',content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function listId(){return $('week').value.trim()||new Date().toISOString().slice(0,10)}
function colId(market,week){return slug(market)+'__'+slug(week)}
function collection(){return db.collections[currentKey]}
function productPrice(p){return collection()?.prices?.[p.id]||null}
function quantityInteger(v){
 const s=String(v??'').trim();
 if(!s)return 0;
 // Regra do relatório: considerar somente o trecho anterior ao ponto.
 const whole=s.split('.')[0].replace(/[^\d-]/g,'');
 const n=parseInt(whole,10);
 return Number.isFinite(n)?n:0;
}
function sortByQuantityDesc(items){return [...items].sort((a,b)=>{const qa=Math.max(0,Number.parseInt(String(a.quantity??'0'),10)||0);const qb=Math.max(0,Number.parseInt(String(b.quantity??'0'),10)||0);return qb-qa;});}
function skuKey(v){return String(v??'').trim().replace(/\.0+$/,'')}
function parseMasterJson(text){
 const raw=JSON.parse(text);
 const arr=Array.isArray(raw)?raw:(Array.isArray(raw.produtos)?raw.produtos:null);
 if(!arr)throw Error('O JSON deve conter uma lista de produtos.');
 const out=arr.map((o,i)=>{
   const get=(...keys)=>{for(const k of keys)if(o[k]!==undefined&&o[k]!==null)return String(o[k]).trim();return ''};
   const sku=get('Código (SKU)','Codigo (SKU)','SKU','sku','codigo');
   return {id:sku||('cadastro_'+(i+1)),sku,ean:get('Código de Barras','Codigo de Barras','EAN','ean','GTIN'),name:get('Nome do Produto','Nome do Produto','Produto','produto','Nome','nome'),unit:get('Unidade de Medida','Unidade de Medida','Unidade','unidade'),ownRaw:get('Valor de Venda','Valor de Venda','Preço','Preco','Valor','valor'),own:money(get('Valor de Venda','Valor de Venda','Preço','Preco','Valor','valor'))};
 }).filter(p=>p.sku);
 if(!out.length)throw Error('Nenhum produto com SKU foi encontrado no JSON.');
 const map=new Map();out.forEach(p=>map.set(skuKey(p.sku),p));
 return [...map.values()];
}
function importMaster(text){
 try{
  const catalog=parseMasterJson(text);db.masterCatalog=catalog;saveDb();
  $('masterCount').textContent=catalog.length;
  $('masterIssues').textContent=catalog.filter(p=>!p.ean||!p.name||p.own===null).length;
  setStatus('masterStatus',`Cadastro importado com sucesso: ${catalog.length} produtos. Agora importe o CSV semanal.`,'ok');
 }catch(e){setStatus('masterStatus',e.message||'Falha ao importar JSON.','err')}
}

const CENTRAL_CATALOG_URL = new URL('./produtos.json', window.location.href).href;
const CATALOG_HASH_KEY = 'pesquisa_precos_catalog_hash_v1';
async function sha256(text){
 try{
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 }catch(e){return String(text.length)+':'+text.slice(0,100)+':'+text.slice(-100)}
}
async function checkCentralCatalog(){
 const status=$('syncStatus');
 try{
  if(location.protocol==='file:'){
   setStatus('syncStatus','Para sincronizar entre celulares, publique index.html e produtos.json no GitHub Pages e abra pelo endereço https://.','');
   return;
  }
  setStatus('syncStatus','Verificando se existe uma versão nova do cadastro central...');
  const response=await fetch(CENTRAL_CATALOG_URL+'?v='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const text=await response.text();
  const catalog=parseMasterJson(text);
  const hash=await sha256(text);
  const oldHash=localStorage.getItem(CATALOG_HASH_KEY);
  const currentCount=(db.masterCatalog||[]).length;
  if(!currentCount){
   if(confirm(`Cadastro central encontrado com ${catalog.length} produtos. Deseja carregá-lo neste celular?`)){
    importMaster(text);
    localStorage.setItem(CATALOG_HASH_KEY,hash);
    setStatus('syncStatus',`Cadastro central carregado: ${catalog.length} produtos.`, 'ok');
   }else setStatus('syncStatus','Cadastro central disponível, mas ainda não foi carregado neste celular.');
   return;
  }
  if(oldHash===hash){
   setStatus('syncStatus',`Cadastro sincronizado. ${catalog.length} produtos; nenhuma atualização disponível.`,'ok');
   return;
  }
  if(confirm(`Foi encontrada uma versão diferente do cadastro central (${catalog.length} produtos). Deseja atualizar o cadastro deste celular? As pesquisas e os preços coletados serão preservados.`)){
   importMaster(text);
   localStorage.setItem(CATALOG_HASH_KEY,hash);
   setStatus('syncStatus',`Cadastro atualizado pelo GitHub: ${catalog.length} produtos. Pesquisas locais preservadas.`,'ok');
  }else{
   setStatus('syncStatus','Existe uma atualização do cadastro central. Você poderá atualizar ao abrir o aplicativo novamente.');
  }
 }catch(e){
  setStatus('syncStatus','Não foi possível consultar o cadastro central. Verifique a publicação do arquivo produtos.json e a conexão. Detalhe: '+(e.message||e),'err');
 }
}

function importSales(text){
 try{
  if(!db.masterCatalog?.length)throw Error('Importe primeiro o cadastro JSON do ConnectPlug.');
  const parsed=parseCSV(text),headers=parsed.headers;
  function findHeader(keys){return headers.findIndex(h=>keys.some(k=>h===k||h.includes(k)))}
  const ix={sku:findHeader(['codigo','codigosku','sku']),name:findHeader(['produto','descricao','nomedoproduto']),qty:findHeader(['quantidade','qtd']),value:findHeader(['valor','valortotal','totalvenda','venda'])};
  if(ix.sku<0||ix.qty<0||ix.value<0)throw Error('Não identifiquei as colunas Código, Quantidade e Valor no CSV.');
  const catalog=new Map(db.masterCatalog.map(p=>[skuKey(p.sku),p]));
  const get=(r,k)=>ix[k]>=0?String(r[ix[k]]??'').trim():'';
  const sales=[],unmatched=[];
  parsed.rows.forEach((r,i)=>{
    const sku=get(r,'sku');
    if(!sku||sku==='---'||norm(sku)==='total:')return;
    const nameCsv=get(r,'name');
    if(norm(nameCsv)==='total:'||norm(sku)==='total')return;
    const master=catalog.get(skuKey(sku));
    const qty=quantityInteger(get(r,'qty'));
    const salesValue=money(get(r,'value'));
    const p=master?{...master}:{id:sku,sku,ean:'',name:nameCsv||'(Produto não encontrado no cadastro)',unit:'',own:null,ownRaw:''};
    sales.push({...p,id:sku,sku,quantity:qty,salesValue,salesName:nameCsv,matched:!!master,row:i+2});
    if(!master)unmatched.push(sku);
  });
  if(!sales.length)throw Error('Nenhum produto válido foi encontrado no CSV.');
  const sortedSales=sortByQuantityDesc(sales);
  const week=new Date().toISOString().slice(0,10),id='lista_'+slug(week)+'_'+Date.now();
  products=sortedSales;db.lists[id]={id,week,created:new Date().toISOString(),products};db.activeList=id;saveDb();
  $('salesCount').textContent=products.length;
  $('previewRows').innerHTML=products.slice(0,10).map(p=>`<tr><td>${esc(p.sku)}</td><td>${esc(p.ean)}</td><td>${esc(p.name)}</td><td class="num">${p.quantity}</td><td class="num">${brl(p.salesValue)}</td><td class="num">${brl(p.own)}</td><td>${p.matched?'Encontrado':'<span class="tag pending">Não encontrado</span>'}</td></tr>`).join('');
  $('importPreview').classList.remove('hidden');$('week').value=week;
  setStatus('importStatus',`Importação concluída: ${products.length} produtos vendidos; ${products.length-unmatched.length} identificados no cadastro; ${unmatched.length} sem correspondência. Linhas "---" e "Total:" ignoradas.`,'ok');
  renderSaved();refreshCompare();
 }catch(e){setStatus('importStatus',e.message||'Falha ao importar CSV.','err')}
}
$('masterFile').addEventListener('change',e=>{const f=e.target.files[0];if(f)setStatus('masterStatus',`Arquivo selecionado: ${f.name}. Clique em “Importar cadastro JSON”.`)});
$('csvFile').addEventListener('change',e=>{const f=e.target.files[0];if(f)setStatus('importStatus',`Arquivo selecionado: ${f.name}. Clique em “Processar relatório CSV”.`)});
$('importMasterBtn').addEventListener('click',async()=>{const f=$('masterFile').files[0];if(!f){setStatus('masterStatus','Selecione primeiro o arquivo JSON.','err');return}setStatus('masterStatus','Lendo e validando o cadastro JSON...');try{importMaster(await f.text())}catch(err){setStatus('masterStatus','Erro ao ler o JSON: '+(err.message||err),'err')}});
$('importSalesBtn').addEventListener('click',async()=>{const f=$('csvFile').files[0];if(!f){setStatus('importStatus','Selecione primeiro o arquivo CSV.','err');return}setStatus('importStatus','Lendo e processando o relatório CSV...');try{importSales(await f.text())}catch(err){setStatus('importStatus','Erro ao ler o CSV: '+(err.message||err),'err')}});
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
function showTab(t){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));['import','collect','compare'].forEach(x=>$('view-'+x).classList.toggle('hidden',x!==t));if(t==='compare')refreshCompare();if(t==='import')renderSaved()}
function renderSaved(){
 const el=$('savedList'),entries=Object.values(db.collections||{});
 if(!entries.length){el.textContent='Nenhuma pesquisa salva.'}else{el.innerHTML=entries.map(c=>{const n=Object.keys(c.prices||{}).filter(k=>c.prices[k]?.status==='done'||c.prices[k]?.status==='unavailable').length;return `<div style="padding:9px 0;border-bottom:1px solid #e4e9f0;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>${esc(c.market)}</b> · ${esc(c.week)} — ${n} registros</div><div style="display:flex;gap:8px"><button class="secondary" style="width:auto;min-height:34px;padding:5px 9px;margin:0" data-resume="${esc(c.key)}">Abrir</button><button class="danger" style="width:auto;min-height:34px;padding:5px 9px;margin:0" data-delete="${esc(c.key)}">Excluir</button></div></div>`}).join('');el.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>{const c=db.collections[b.dataset.resume];if(!c)return;$('supermarket').value=c.market;$('week').value=c.week;currentKey=c.key;products=productsForCollection(c);showTab('collect');prepareSequence(true)});el.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const key=b.dataset.delete,c=db.collections[key];if(!c)return;if(!confirm(`Excluir a pesquisa de ${c.market} da referência ${c.week}? Os preços registrados nessa pesquisa serão removidos. Esta ação não pode ser desfeita.`))return;delete db.collections[key];if(currentKey===key){currentKey='';$('collector').classList.add('hidden');setStatus('collectStatus','Pesquisa excluída. Selecione um supermercado para iniciar outra coleta.','ok')}saveDb();refreshCompare();setStatus('importStatus',`Pesquisa de ${c.market} (${c.week}) excluída.`,'ok')})}
 const markets=[...new Set(entries.map(c=>c.market))];$('exportMarket').innerHTML=markets.map(m=>`<option>${esc(m)}</option>`).join('');updateWeekOptions();
}
function productsForCollection(c){const l=db.lists[c.listId];return l?.products||products||[]}
function updateWeekOptions(){const m=$('exportMarket').value;const weeks=[...new Set(Object.values(db.collections).filter(c=>!m||c.market===m).map(c=>c.week))];$('exportWeek').innerHTML=weeks.map(w=>`<option>${esc(w)}</option>`).join('')}
$('exportMarket').addEventListener('change',updateWeekOptions);
$('startCollect').addEventListener('click',()=>{
 if(!products.length){setStatus('collectStatus','Importe primeiro a lista CSV na aba “Lista CSV”.','err');return}
 const market=$('supermarket').value.trim();if(!market){setStatus('collectStatus','Informe o nome do supermercado.','err');return}
 const week=listId();currentKey=colId(market,week);
 if(!db.collections[currentKey])db.collections[currentKey]={key:currentKey,market,week,listId:db.activeList,prices:{},created:new Date().toISOString(),updated:new Date().toISOString()};
 else {db.collections[currentKey].market=market;db.collections[currentKey].listId=db.activeList||db.collections[currentKey].listId}
 saveDb();prepareSequence(false);$('collector').classList.remove('hidden');setStatus('collectStatus',`Coleta ativa: ${market} · ${week}. Os preços são salvos neste celular.`,'ok');
});
function prepareSequence(resume){
 const c=collection();if(!c){setStatus('collectStatus','Selecione um supermercado e inicie a coleta.','err');return}
 let ids=products.map(p=>p.id);if($('order').value==='pending'){ids.sort((a,b)=>{const pa=c.prices[a]?.status==='done'||c.prices[a]?.status==='unavailable',pb=c.prices[b]?.status==='done'||c.prices[b]?.status==='unavailable';return Number(pa)-Number(pb)})}
 sequence=ids;seqPos=0;
 if(resume){const firstPending=sequence.findIndex(id=>!['done','unavailable'].includes(c.prices[id]?.status));seqPos=firstPending>=0?firstPending:0}
 currentProductId=sequence[seqPos];$('collector').classList.remove('hidden');renderCurrent();renderProductTable();saveDb();
}
function renderCurrent(){
 const c=collection();if(!c||!products.length)return;
 if(seqPos<0)seqPos=0;if(seqPos>=sequence.length)seqPos=sequence.length-1;
 currentProductId=sequence[seqPos];const p=products.find(x=>x.id===currentProductId);if(!p)return;
 const record=c.prices[p.id];$('position').textContent=(seqPos+1)+'/'+sequence.length;
 const done=Object.values(c.prices).filter(x=>['done','unavailable'].includes(x.status)).length;
 $('doneCount').textContent=done;$('pendingCount').textContent=Math.max(0,products.length-done);$('progressBar').style.width=(products.length?done/products.length*100:0)+'%';
 $('productName').textContent=p.name||'(Sem descrição)';$('productEan').textContent=p.ean||'(Sem EAN)';$('skuUnit').textContent='SKU: '+(p.sku||'—')+' · Unidade: '+(p.unit||'—');$('ownPrice').textContent='Preço da sua loja: '+brl(p.own);
 $('marketPrice').value=record?.status==='done'&&record.price!==null?Number(record.price).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
 if(typeof JsBarcode==='function'&&p.ean){try{const fmt=/^\d{13}$/.test(p.ean)?'EAN13':/^\d{12}$/.test(p.ean)?'UPC':/^\d{8}$/.test(p.ean)?'EAN8':'CODE128';JsBarcode($('barcode'),p.ean,{format:fmt,width:2.1,height:85,displayValue:false,margin:10});$('barcodeFallback').classList.add('hidden');$('barcode').classList.remove('hidden')}catch(e){$('barcode').innerHTML='';$('barcodeFallback').classList.remove('hidden')}}else{$('barcode').innerHTML='';$('barcodeFallback').classList.remove('hidden')}
 $('marketPrice').focus({preventScroll:true});renderProductTable();
}
function savePrice(status,price=null){
 const c=collection(),p=products.find(x=>x.id===currentProductId);if(!c||!p)return;
 c.prices[p.id]={status,price,updated:new Date().toISOString(),sku:p.sku,ean:p.ean,name:p.name};
 c.updated=new Date().toISOString();saveDb();refreshCompare();nextProduct();
}
function nextProduct(){if(seqPos<sequence.length-1)seqPos++;renderCurrent()}
$('confirmPrice').addEventListener('click',()=>{const raw=$('marketPrice').value,price=money(raw);if(price===null||price<0){setStatus('collectStatus','Informe um preço válido, por exemplo 12,38.','err');$('marketPrice').focus();return}savePrice('done',price)});
$('marketPrice').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('confirmPrice').click()}});
$('markUnavailable').addEventListener('click',()=>savePrice('unavailable',null));
$('skipProduct').addEventListener('click',nextProduct);
$('previousProduct').addEventListener('click',()=>{if(seqPos>0)seqPos--;renderCurrent()});
$('openList').addEventListener('click',()=>{$('listCard').classList.toggle('hidden');renderProductTable()});
function renderProductTable(){
 if(!products.length)return;const c=collection(),q=norm($('searchProducts').value);
 const filtered=products.filter(p=>!q||norm([p.sku,p.ean,p.name].join(' ')).includes(q));
 $('productRows').innerHTML=filtered.map(p=>{const r=c?.prices?.[p.id],done=['done','unavailable'].includes(r?.status);return `<tr><td><span class="tag ${done?'done':'pending'}">${r?.status==='unavailable'?'Indisponível':done?'Coletado':'Pendente'}</span></td><td>${esc(p.sku)}</td><td>${esc(p.ean)}</td><td>${esc(p.name)}</td><td class="num">${brl(p.own)}</td><td class="num">${r?.status==='done'?brl(r.price):'—'}</td><td><button class="secondary" style="min-height:34px;padding:5px 9px" data-go="${esc(p.id)}">Abrir</button></td></tr>`}).join('');
 $('productRows').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const ix=sequence.indexOf(b.dataset.go);if(ix>=0){seqPos=ix;renderCurrent();window.scrollTo({top:0,behavior:'smooth'})}});
}
$('searchProducts').addEventListener('input',renderProductTable);
function refreshCompare(showFeedback=false){
 const cols=Object.values(db.collections||{});const head=$('compareHead'),body=$('compareRows');
 if(!products.length&&db.activeList&&db.lists[db.activeList])products=db.lists[db.activeList].products;
 if(!products.length||!cols.length){head.innerHTML='';body.innerHTML='';setStatus('compareStatus','Importe uma lista e registre preços em pelo menos um supermercado.');renderSaved();return}
 const markets=[...new Set(cols.map(c=>c.market))].sort();
 // A MESMA condição determina a célula amarela e seu subtotal.
 // Os totais são acumulados em centavos, sem arredondamentos intermediários.
 const marketTotals=markets.map(()=>({cents:0,count:0}));
 let overallCents=0,overallCount=0;
 const compareRows=sortByQuantityDesc(products).map(p=>{
  const vals=markets.map(m=>{
   let best=null;
   cols.filter(c=>c.market===m).forEach(c=>{
    const r=c.prices?.[p.id];
    if(r?.status==='done'&&r.price!==null&&r.price!==undefined){
     const v=Number(r.price);
     if(Number.isFinite(v)&&v>=0&&(best===null||v<best))best=v;
    }
   });
   return best;
  });
  const cents=vals.map(v=>v===null?null:Math.round(v*100));
  const valid=cents.filter(v=>v!==null);
  const min=valid.length?Math.min(...valid):null;
  const qty=Math.max(0,Number.parseInt(String(p.quantity??'0'),10)||0);
  const yellow=cents.map(v=>min!==null&&v!==null&&v===min);
  if(min!==null){
   overallCents+=qty*min;
   overallCount++;
  }
  const priceCells=cents.map((v,i)=>{
   const isYellow=yellow[i];
   if(isYellow){marketTotals[i].cents+=qty*v;marketTotals[i].count++}
   return `<td class="num${isYellow?' best-price-cell':''}" ${isYellow?'style="background-color:#ffeb3b !important;color:#000 !important;font-weight:800"':''}>${brl(v===null?null:v/100)}</td>`;
  }).join('');
  return `<tr><td>${esc(p.sku)}</td><td>${esc(p.ean)}</td><td>${esc(p.name)}</td><td class="num">${p.quantity??'—'}</td><td class="num">${brl(p.own)}</td>${priceCells}<td class="num"><b>${brl(min===null?null:min/100)}</b></td></tr>`;
 });
 const totalCell=x=>x.count?brl(x.cents/100):'—';
 head.innerHTML='<tr class="totals-row"><th rowspan="2">SKU</th><th rowspan="2">EAN</th><th rowspan="2">Produto</th><th rowspan="2" class="num">Quantidade</th><th rowspan="2" class="num">Seu preço</th>'+markets.map((m,i)=>`<th class="num">${totalCell(marketTotals[i])}</th>`).join('')+`<th class="num">${overallCount?brl(overallCents/100):'—'}</th></tr><tr>`+markets.map(m=>`<th class="num">${esc(m)}</th>`).join('')+'<th class="num">Menor preço</th></tr>';
 body.innerHTML=compareRows.join('');
 const updatedAt=new Date().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
 const baseMsg=`${products.length} produtos · ${markets.length} supermercados com pesquisas salvas.`;
 setStatus('compareStatus',showFeedback?`Comparativo atualizado com sucesso em ${updatedAt}. ${baseMsg}`:baseMsg,'ok');renderSaved();
}
$('refreshCompare').addEventListener('click',()=>refreshCompare(true));
function csvForCollection(c){
 const l=db.lists[c.listId],ps=l?.products||products;
 const rows=[['Código (SKU)','Código de Barras','Nome do Produto','Unidade de Medida','Valor de Venda','Quantidade Vendida','Valor Total Vendido','Supermercado','Referência','Preço Coletado','Status','Data/Hora']];
 ps.forEach(p=>{const r=c.prices?.[p.id];rows.push([p.sku,p.ean,p.name,p.unit,p.own===null?'':Number(p.own).toFixed(2).replace('.',','),p.quantity??'',p.salesValue===null||p.salesValue===undefined?'':Number(p.salesValue).toFixed(2).replace('.',','),c.market,c.week,r?.price===null||r?.price===undefined?'':Number(r.price).toFixed(2).replace('.',','),r?.status==='done'?'Coletado':r?.status==='unavailable'?'Indisponível':'Pendente',r?.updated||''])});
 return rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
$('exportSingle').addEventListener('click',()=>{const market=$('exportMarket').value,week=$('exportWeek').value,c=Object.values(db.collections).find(x=>x.market===market&&x.week===week);if(!c){setStatus('compareStatus','Não encontrei coleta para essa seleção.','err');return}download(`precos_${slug(market)}_${slug(week)}.csv`,csvForCollection(c))});
$('exportCompare').addEventListener('click',()=>{
 const cols=Object.values(db.collections);if(!products.length||!cols.length){setStatus('compareStatus','Não há dados para exportar.','err');return}
 const markets=[...new Set(cols.map(c=>c.market))].sort();const rows=[['Código (SKU)','Código de Barras','Nome do Produto','Unidade de Medida','Quantidade Vendida','Valor Total Vendido','Seu preço',...markets,'Menor preço']];
 products.forEach(p=>{const vals=markets.map(m=>{let v=null;cols.filter(c=>c.market===m).forEach(c=>{const r=c.prices?.[p.id];if(r?.status==='done'&&r.price!==null&&(v===null||r.price<v))v=r.price});return v});const valid=vals.filter(v=>v!==null);rows.push([p.sku,p.ean,p.name,p.unit,p.quantity??'',p.salesValue===null||p.salesValue===undefined?'':Number(p.salesValue).toFixed(2).replace('.',','),p.own===null?'':Number(p.own).toFixed(2).replace('.',','),...vals.map(v=>v===null?'':Number(v).toFixed(2).replace('.',',')),valid.length?Number(Math.min(...valid)).toFixed(2).replace('.',','):''])});
 download(`comparativo_precos_${new Date().toISOString().slice(0,10)}.csv`,rows.map(r=>r.map(csvCell).join(';')).join('\r\n'));
});
$('fullscreenBarcode').addEventListener('click',()=>{const p=products.find(x=>x.id===currentProductId);if(!p?.ean)return;try{const f=/^\d{13}$/.test(p.ean)?'EAN13':/^\d{12}$/.test(p.ean)?'UPC':/^\d{8}$/.test(p.ean)?'EAN8':'CODE128';JsBarcode($('bigBarcode'),p.ean,{format:f,width:3.2,height:145,displayValue:false,margin:12});$('bigEan').textContent=p.ean;$('fullscreen').classList.add('show');if($('fullscreen').requestFullscreen)$('fullscreen').requestFullscreen().catch(()=>{})}catch(e){alert('Não foi possível gerar o código para este EAN.')}}); 
$('closeFullscreen').addEventListener('click',()=>{ $('fullscreen').classList.remove('show');if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{})});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)$('fullscreen').classList.remove('show')});
$('exportBackup').addEventListener('click',()=>download(`backup_pesquisa_precos_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(db,null,2),'application/json'));
$('importBackupBtn').addEventListener('click',()=>$('backupFile').click());
$('backupFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const x=JSON.parse(await f.text());if(!x.lists||!x.collections)throw Error('Formato de backup inválido.');db=x;products=db.activeList&&db.lists[db.activeList]?db.lists[db.activeList].products:[];saveDb();setStatus('importStatus','Backup restaurado.','ok');renderSaved()}catch(err){setStatus('importStatus','Falha ao restaurar backup: '+err.message,'err')}});
window.addEventListener('load',()=>{
 if(db.masterCatalog?.length){$('masterCount').textContent=db.masterCatalog.length;$('masterIssues').textContent=db.masterCatalog.filter(p=>!p.ean||!p.name||p.own===null).length;setStatus('masterStatus',`Cadastro recuperado: ${db.masterCatalog.length} produtos.`,'ok')} if(db.activeList&&db.lists[db.activeList]){products=db.lists[db.activeList].products;$('salesCount').textContent=products.length;$('importPreview').classList.remove('hidden');$('previewRows').innerHTML=products.slice(0,10).map(p=>`<tr><td>${esc(p.sku)}</td><td>${esc(p.ean)}</td><td>${esc(p.name)}</td><td class="num">${p.quantity??''}</td><td class="num">${brl(p.salesValue)}</td><td class="num">${brl(p.own)}</td><td>${p.matched===false?'<span class="tag pending">Não encontrado</span>':'Encontrado'}</td></tr>`).join('');setStatus('importStatus',`Lista recuperada: ${products.length} produtos.`,'ok')}
 renderSaved();refreshCompare();
 checkCentralCatalog();
});
})();
