import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import {PDFDocument} from '../src/pdf-lib-vendor.mjs';
const oldFetch=globalThis.fetch;let external=0;
globalThis.fetch=async()=>{external++;throw Error('Chamadas externas proibidas');};
const clients=[];
async function client(host,name,color){
  const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort())db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  function statement(sql,args=[]){return {bind(...values){return statement(sql,values)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return db.prepare(sql).run(...args)}};}
  const env={INITIAL_ADMIN_PASSWORD:'senha-inicial-somente-teste',DB:{prepare:statement,async batch(items){db.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}},pending=[];let csrf='',cookie='';
  async function call(path,values,{authenticated=false,origin='https://'+host,session=cookie}={}){
    const headers={Cookie:csrf+(authenticated?'; '+session:'')};if(values){headers.Origin=origin;values={...values,csrf:csrf.split('=')[1]};headers['Content-Type']='application/x-www-form-urlencoded';}
    const r=await worker.fetch(new Request('https://'+host+path,{method:values?'POST':'GET',headers,body:values?new URLSearchParams(values):undefined}),env,{waitUntil(p){pending.push(p);}});
    if(!csrf&&r.headers.get('set-cookie'))csrf=r.headers.get('set-cookie').split(';')[0];return r;
  }
  clients.push({db,call,env,pending,get cookie(){return cookie;}});
  await call('/admin/login');assert.equal((await call('/admin/identidade')).status,303);
  assert.equal((await call('/admin/configurar?chave=qualquer')).status,404);
  const login=await call('/admin/login',{password:env.INITIAL_ADMIN_PASSWORD});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/admin',undefined,{authenticated:true})).headers.get('location'),'/admin/identidade?primeiro=1');
  assert.equal((await call('/admin/identidade',{name,color,subtitle:'EVENTOS'},{authenticated:true,origin:'https://outro.example.test'})).status,403);
  assert.equal((await call('/admin/identidade',{name,color,subtitle:'EVENTOS'},{authenticated:true})).status,303);
  const home=await (await call('/')).text();assert.ok(home.includes(name.replaceAll('&','&amp;')));assert.ok(!home.includes('Somaforce'));assert.ok(!home.includes(env.INITIAL_ADMIN_PASSWORD));
  assert.ok((await (await call('/style.css')).text()).includes('--accent:'+color));
  assert.equal((await call('/admin',{action:'event',name:'Evento '+name,date:'2026-12-10',location:'Local',registrations_open:'yes'},{authenticated:true})).status,303);
  const invite=await (await call('/eventos/1')).text();assert.ok(invite.includes('dados pela '+name.replaceAll('&','&amp;')));
  const result=await call('/eventos/1',{company:'Empresa do participante',name:'Participante '+name,phone:'11999998888',consent:'yes'});assert.equal(result.status,303);
  await call('/admin',{action:'activate',id:'1',return_to:'/admin'},{authenticated:true});
  const checkin=await call('/',{event_id:'1',phone:'11999998888',consent:'yes'});assert.equal(checkin.status,303);
  await Promise.all(pending);
  const templateConfig=JSON.stringify({body:'{{nome}} participou de {{evento}}.',align:'center',color:'#252525',font:'Helvetica',x:10,y:40,width:80,height:20,font_size:18});
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  db.prepare('INSERT INTO certificate_templates(id,name,content_type,asset_base64,width,height,config_json) VALUES (?,?,?,?,?,?,?)').run('teste','Modelo de teste','image/png',png,841.89,595.28,templateConfig);
  db.prepare("UPDATE events SET certificate_template_id='teste',certificate_enabled=1 WHERE id=1").run();
  const participant=db.prepare('SELECT token FROM registrations').get().token;
  const certificate=await call('/certificados/'+participant+'/baixar.pdf');assert.equal(certificate.status,200);assert.equal((await PDFDocument.load(await certificate.arrayBuffer())).getAuthor(),name);
  assert.ok((await (await call('/assets/certificate-print-client.mjs')).text()).includes('combined.setAuthor('+JSON.stringify(name)+')'));
  const pdf=await call('/admin/export.pdf?event=1',undefined,{authenticated:true});assert.equal(pdf.status,200);assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getAuthor(),name);
  assert.equal(db.prepare('SELECT count(*) n FROM registrations').get().n,1);
  const before=db.prepare("SELECT value FROM settings WHERE key='admin_password'").get().value;env.INITIAL_ADMIN_PASSWORD='senha-trocada-no-provedor';await call('/');assert.equal(db.prepare("SELECT value FROM settings WHERE key='admin_password'").get().value,before);
  return clients.at(-1);
}
try{
  const a=await client('cliente-alfa.example.test','Alfa & Treinamentos','#1454b8'),b=await client('cliente-beta.example.test','Empresa Beta','#882244');
  assert.equal((await b.call('/admin',undefined,{authenticated:true,session:a.cookie})).status,303);
  const pages=await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).call('/eventos/1').then(r=>r.text())));
  pages.forEach((html,i)=>{assert.ok(html.includes(i%2?'Alfa &amp; Treinamentos':'Empresa Beta'));assert.ok(!html.includes(i%2?'Empresa Beta':'Alfa &amp; Treinamentos'));});
  assert.notEqual(await (await a.call('/qr.svg')).text(),await (await b.call('/qr.svg')).text());
  const bad=await worker.fetch(new Request('https://novo.example.test/'),{DB:a.env.DB,INITIAL_ADMIN_PASSWORD:''},{waitUntil(){}});assert.equal(bad.status,200);
  assert.equal((await worker.fetch(new Request('https://novo.example.test/'),{},{waitUntil(){}})).status,503);
  assert.equal(external,0);
  console.log('OK: primeira senha sem reivindicação pública; configuração da marca online protegida; login; inscrição; check-in; PDF com marca; sessões e dados isolados; concorrência sem mistura de empresas; segredo inicial não redefine a senha existente; zero envios externos.');
}finally{globalThis.fetch=oldFetch;for(const c of clients)c.db.close();}
