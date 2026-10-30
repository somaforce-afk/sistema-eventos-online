import {identity} from './identity.mjs';
import {handleIdentity} from './identity-routes.mjs';
import qrcode from './qrcode.mjs';
import {getStaffContext,handleReception} from './reception-team.mjs';
import {handleEventTools} from './event-tools.mjs';
import {archiveRecords,searchFilter,certificateMetadata,certificateJoins} from './record-management.mjs';
import {handleParticipantActions} from './participant-actions.mjs';
import {handleAdminPages,adminNavigation,eventTabs} from './admin-pages.mjs';
import {createParticipantPdf} from './pdf-list.mjs';
import {handleCertificateRoutes} from './certificate-routes.mjs';
import {ensureCertificate} from './certificates.mjs';
import {esc,hidden,field,button,form,card,redirect,page,notice,statusOf,eventDetails,consent,personFields,eventFields,invite,ticket,reception,checkinForms,newCheckinForm,checkinHome} from './ui.mjs';

const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');
const encoder=new TextEncoder();
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),value=>value.toString(16).padStart(2,'0')).join('');}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256)),value=>value.toString(16).padStart(2,'0')).join('');}
const phoneOf=value=>{let phone=String(value||'').replace(/\D/g,'');if((phone.length===12||phone.length===13)&&phone.startsWith('55'))phone=phone.slice(2);return phone;};
const safeNext=value=>/^\/admin\/recepcao\/[a-f0-9]{64}$/.test(value||'')?value:'/admin';
const participantSelect='SELECT r.*,e.name AS event,e.date,e.start_time,e.end_time,e.location,e.active,e.finished,'+certificateMetadata+' FROM registrations r JOIN events e ON e.id=r.event_id'+certificateJoins;
const filterClause="r.waitlisted=0 AND (?='' OR e.id=?) AND (?='' OR (?='presente' AND r.checked_in_at IS NOT NULL) OR (?='inscrito' AND r.checked_in_at IS NULL AND e.finished=0) OR (?='ausente' AND r.checked_in_at IS NULL AND e.finished=1))";
function filterParams(url){const event=url.searchParams.get('event')||'',status=url.searchParams.get('status')||'';return [event,event,status,status,status,status];}
function qrResponse(text){const code=qrcode(0,'M');code.addData(text);code.make();return new Response(code.createSvgTag({cellSize:5,margin:20,scalable:true}),{headers:{'Content-Type':'image/svg+xml'}});}
async function invitationPreview(event,origin){
  const version=(await hash(JSON.stringify([event.name,event.date,event.start_time,event.end_time,event.location,event.description,event.image_base64]))).slice(0,16);
  const description=[event.date.split('-').reverse().join('/'),event.start_time,event.location,'Inscreva-se para participar.'].filter(Boolean).join(' · ');
  return {title:event.name+' | '+identity().name,description,url:origin+'/eventos/'+event.id+'?convite='+version,image:origin+(event.image_base64?'/eventos/'+event.id+'/imagem?v='+version:'/logo.png'),imageType:event.image_base64?event.image_type:'image/png'};
}

async function notify(env,token,kind='checkin'){
  const config=await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('telegram_token','telegram_chat','telegram_enabled')").all();
  const values=Object.fromEntries(config.results.map(row=>[row.key,row.value]));
  if(values.telegram_enabled!=='1'||!values.telegram_token||!values.telegram_chat)return;
  const column=kind==='inscricao'?'enrollment_telegram':'telegram';
  const condition=kind==='inscricao'?"source='antecipada'":'checked_in_at IS NOT NULL';
  const claimed=await env.DB.prepare(`UPDATE registrations SET ${column}='enviando' WHERE token=? AND ${column} IN ('pendente','falhou') AND ${condition} RETURNING *`).bind(token).first();
  if(!claimed)return;
  const event=await env.DB.prepare('SELECT name FROM events WHERE id=?').bind(claimed.event_id).first();
  let status='falhou';
  try{
    const text=`${identity().name} | ${kind==='inscricao'?(claimed.waitlisted?'Entrada na lista de espera':'Nova inscrição'):'Presença confirmada'} #${claimed.id}\nEvento: ${event.name}\nEmpresa: ${claimed.company}\nNome: ${claimed.name}\nTelefone: ${claimed.phone}\nRegistro UTC: ${kind==='inscricao'?claimed.created:claimed.checked_in_at}`;
    const response=await fetch(`https://api.telegram.org/bot${values.telegram_token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:values.telegram_chat,text}),signal:AbortSignal.timeout(8000)});
    if(response.ok&&(await response.json()).ok)status='enviado';
  }catch{}
  await env.DB.prepare(`UPDATE registrations SET ${column}=? WHERE token=?`).bind(status,token).run();
}

export default{
  async fetch(request,env,ctx){
    try{
      const response=await handle(request,env,ctx);
      const csrfCookie=request.headers.get('Cookie')?.match(/(?:^|; )__Host-sf_csrf=([a-f0-9]{64})(?:;|$)/)?.[1];
      const csrf=csrfCookie||random();
      const html=response.headers.get('Content-Type')?.startsWith('text/html');
      const adminPath=new URL(request.url).pathname;
      const adminNav=adminPath.startsWith('/admin')&&!['/admin/login','/admin/configurar'].includes(adminPath)?adminNavigation(adminPath):'';
      const body=html?(await response.text()).replace('<main>','<main>'+adminNav).replace(/<form method="post"[^>]*>/g,tag=>tag+hidden('csrf',csrf)):response.body;
      const secured=new Response(body,response);
      if(html&&!csrfCookie)secured.headers.append('Set-Cookie',`__Host-sf_csrf=${csrf}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
      for(const [key,value]of Object.entries({'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'"}))secured.headers.set(key,value);
      return secured;
    }catch{return new Response('Não foi possível concluir. Tente novamente ou contate a organização.',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
  }
};

async function handle(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/assets/pdf-lib-vendor.mjs')return new Response(env.PDF_CLIENT_JS,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/assets/certificate-print-client.mjs')return new Response(env.PRINT_CLIENT_JS,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  const logoBase64=env.LOGO_BASE64;
  const query=(sql,...params)=>env.DB.prepare(sql).bind(...params);
  const get=async key=>(await query('SELECT value FROM settings WHERE key=?',key).first())?.value||'';
  const set=(key,value)=>query('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);
  if(path==='/style.css')return new Response(env.CSS,{headers:{'Content-Type':'text/css'}});
  if(path==='/logo.png')return new Response(Uint8Array.from(atob(logoBase64),char=>char.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
  if(path==='/qr.svg')return new Response(env.QR_SVG,{headers:{'Content-Type':'image/svg+xml'}});
  const cookie=request.headers.get('Cookie')?.match(/(?:^|; )sf_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const session=cookie?await query('SELECT id FROM sessions WHERE id=? AND expires>unixepoch()',await hash(cookie)).first():null;
  const staff=await getStaffContext(request,env,hash);
  let data;
  if(request.method==='POST'){
    const origin=request.headers.get('Origin');
    if(origin&&origin!=='null'&&origin!==url.origin)return new Response('Origem inválida',{status:403});
    const maxBytes=session?800000:16384;
    if(Number(request.headers.get('Content-Length')||0)>maxBytes)return new Response('Formulário muito grande',{status:413});
    const bytes=await request.arrayBuffer();
    if(bytes.byteLength>maxBytes)return new Response('Formulário muito grande',{status:413});
    const type=request.headers.get('Content-Type')||'';
    if(type.startsWith('multipart/form-data'))data=await new Response(bytes,{headers:{'Content-Type':type}}).formData();
    else data=new URLSearchParams(new TextDecoder().decode(bytes));
    const csrf=request.headers.get('Cookie')?.match(/(?:^|; )__Host-sf_csrf=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!csrf||data.get('csrf')!==csrf)return notice('Atualize o formulário','Reabra a página e tente novamente. Seu formulário precisa de uma sessão válida.',400);
    if(!session&&!(staff&&path.startsWith('/recepcao/'))){
      const bucket=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+path+Math.floor(Date.now()/300000));
      const limit=await query('INSERT INTO limits(bucket,count,expires) VALUES (?,1,unixepoch()+600) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',bucket).first();
      ctx.waitUntil(query('DELETE FROM limits WHERE expires<unixepoch()').run());
      if(limit.count>25)return notice('Muitas tentativas','Aguarde cinco minutos e tente novamente.',429);
    }
  }else if(request.method!=='GET')return new Response('Método inválido',{status:405});
  const adminPassword=await get('admin_password');
  if(path==='/admin/configurar'){
    const supplied=url.searchParams.get('chave');
    if(adminPassword||!supplied||supplied!==env.SETUP_KEY)return new Response('Link indisponível',{status:404});
    if(data){
      const password=data.get('password')||'';
      if(password.length<12||password.length>128||password!==data.get('confirm'))return notice('Confira a senha','Use de 12 a 128 caracteres e repita a mesma senha.',400);
      const salt=random();
      await query("INSERT INTO settings VALUES ('admin_password',?) ON CONFLICT(key) DO NOTHING",salt+':'+await passwordHash(password,salt)).run();
      return redirect('/admin/login');
    }
    return page(card('<h1>Bem-vindo à Gestão de Eventos</h1><p>Crie sua senha administrativa. Este link só funciona uma vez.</p>'+form(path+url.search,field('Crie sua senha (mínimo 12 caracteres)','password','password')+field('Repita sua senha','confirm','password')+button('Criar acesso'))));
  }
  if(path==='/admin/login'){
    const next=safeNext(data?.get('next')||url.searchParams.get('next'));
    if(session)return redirect(next);
    if(data&&adminPassword){
      const [salt,expected]=adminPassword.split(':');
      if(await passwordHash(data.get('password')||'',salt)===expected){
        const token=random();
        await query('INSERT INTO sessions VALUES (?,unixepoch()+28800)',await hash(token)).run();
        return new Response(null,{status:303,headers:{Location:next,'Set-Cookie':`sf_session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`}});
      }
    }
    return page(card(`<h1>Organização</h1>${data?'<p>Acesso inválido.</p>':''}${form('/admin/login',hidden('next',next)+field('Senha administrativa','password','password')+button('Entrar no painel →'))}`));
  }
  if(path.startsWith('/admin')&&!session)return redirect('/admin/login'+(safeNext(path)!=='/admin'?'?next='+encodeURIComponent(path):''));
  const identityResponse=await handleIdentity({path,url,data,env});
  if(identityResponse)return identityResponse;
  const teamPage=await handleReception({request,path,url,env,data,staff,hash,passwordHash,random,notify,ensureCertificate,ctx});
  if(teamPage)return teamPage;
  const eventTool=await handleEventTools({path,url,env,data,readEvent,hash});
  if(eventTool)return eventTool;
  if(path.startsWith('/admin')){const actionPage=await handleParticipantActions({path,url,env,data});if(actionPage)return actionPage;}
  const certificateResponse=await handleCertificateRoutes({request,path,url,env,data});
  if(certificateResponse){
    const match=path.match(/^\/admin\/certificados\/eventos\/(\d+)/);
    if(match&&certificateResponse.headers.get('Content-Type')?.startsWith('text/html')){
      const event=await query('SELECT id,name FROM events WHERE id=?',match[1]).first();
      if(event)return new Response((await certificateResponse.text()).replace('<main>','<main>'+eventTabs(event,'certificates')),certificateResponse);
    }
    return certificateResponse;
  }
  if(path==='/admin/logout'&&data){
    await query('DELETE FROM sessions WHERE id=?',session.id).run();
    return new Response(null,{status:303,headers:{Location:'/','Set-Cookie':'sf_session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});
  }
  if(path.startsWith('/admin/excluir/')){
    const token=path.slice('/admin/excluir/'.length);
    const row=await query(participantSelect+' WHERE r.token=?',token).first();
    if(!row)return new Response('Participante não encontrado ou já excluído.',{status:404});
    if(row.telegram==='enviando'||row.enrollment_telegram==='enviando')return notice('Envio em andamento','Aguarde a conclusão do envio ao Telegram antes de excluir este participante.');
    if(data){
      if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
      try{await archiveRecords(env,'participant',row);}catch(error){return notice('Não foi possível excluir',esc(error.message),409);}
      return redirect('/admin/eventos/'+row.event_id+'/participantes?excluido=1');
    }
    return page(card(`<h1>Confirmar exclusão?</h1><p><strong>${esc(row.name)}</strong><br>Empresa: ${esc(row.company)}<br>Telefone: ${esc(row.phone)}<br>Evento: ${esc(row.event)}</p><p>A inscrição, a presença e o certificado irão para a Lixeira. A vaga será liberada e os links ficarão desativados até uma restauração. Mensagens já enviadas ao Telegram permanecem no grupo.</p>${form(path,hidden('confirm','yes')+button('Enviar para a Lixeira'))}<p><a href="/admin/eventos/${row.event_id}/participantes">Cancelar e voltar</a></p>`));
  }
  const receptionMatch=path.match(/^\/admin\/recepcao\/([a-f0-9]{64})$/);
  if(receptionMatch){
    const token=receptionMatch[1];
    let row=await query(participantSelect+' WHERE r.token=?',token).first();
    if(!row)return new Response('Inscrição não encontrada',{status:404});
    if(data){
      if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
      const changed=await query("UPDATE registrations SET checked_in_at=CURRENT_TIMESTAMP,telegram='pendente' WHERE token=? AND waitlisted=0 AND checked_in_at IS NULL AND EXISTS(SELECT 1 FROM events WHERE events.id=registrations.event_id AND active=1) RETURNING id",token).first();
      if(changed)ctx.waitUntil(notify(env,token));
      if(changed)ctx.waitUntil(ensureCertificate(env,token).catch(()=>null));
      row=await query(participantSelect+' WHERE r.token=?',token).first();
    }
    return reception(row);
  }
  if(path==='/admin/buscar'){
    const event=url.searchParams.get('event')||'',phone=phoneOf(url.searchParams.get('phone'));
    const row=await query('SELECT token FROM registrations WHERE event_id=? AND phone=?',event,phone).first();
    return row?redirect('/admin/recepcao/'+row.token):notice('Inscrição não encontrada','Confira o evento e o telefone com DDD. Para quem não se inscreveu, use o formulário de check-in do dia. <a href="/admin">Voltar ao painel</a>');
  }
  const deleteEventMatch=path.match(/^\/admin\/eventos\/(\d+)\/excluir$/);
  if(deleteEventMatch){
    const eventId=deleteEventMatch[1];
    const event=await query("SELECT e.*,(SELECT count(*) FROM registrations WHERE event_id=e.id) AS total,(SELECT count(*) FROM registrations WHERE event_id=e.id AND checked_in_at IS NOT NULL) AS present,(SELECT count(*) FROM certificates c JOIN registrations r ON r.id=c.registration_id WHERE r.event_id=e.id) AS certificates,(SELECT count(*) FROM registrations WHERE event_id=e.id AND (telegram='enviando' OR enrollment_telegram='enviando')) AS sending FROM events e WHERE id=?",eventId).first();
    if(!event)return new Response('Evento não encontrado ou já excluído.',{status:404});
    if(event.sending)return notice('Envio em andamento','Aguarde os envios ao Telegram terminarem antes de excluir este evento. <a href="/admin">Voltar ao painel</a>',409);
    if(data){
      if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
      try{await archiveRecords(env,'event',event);}catch(error){return notice('Não foi possível excluir',esc(error.message),409);}
      return redirect('/admin/eventos?evento_excluido=1');
    }
    return page(card(`<p class="eyebrow">EXCLUIR EVENTO</p><h1>Excluir este evento?</h1><h2>${esc(event.name)}</h2>${eventDetails(event)}<p class="notice">O evento será enviado para a Lixeira. Serão removidos da lista ativa ${event.total} participantes, incluindo ${event.present} presenças, e ${event.certificates} vínculos de certificado.</p><p>O convite, os ingressos, as imagens do evento e os links individuais deixarão de funcionar. Mensagens já enviadas ao Telegram permanecerão no grupo.</p>${event.active?'<p>Este evento está com check-in aberto. Ao excluí-lo, o QR permanente ficará sem evento ativo até você abrir outro.</p>':''}${form(path,hidden('confirm','yes')+button('Enviar evento para a Lixeira'))}<p><a href="/admin/eventos/${event.id}/painel">Cancelar e manter evento</a></p>`));
  }
  const finishEventMatch=path.match(/^\/admin\/eventos\/(\d+)\/encerrar$/);
  if(finishEventMatch){
    const event=await query('SELECT * FROM events WHERE id=?',finishEventMatch[1]).first();
    if(!event)return new Response('Evento não encontrado',{status:404});
    if(data){
      if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
      await query('UPDATE events SET active=0,finished=1,registrations_open=0 WHERE id=?',event.id).run();
      return redirect('/admin/eventos/'+event.id+'/painel');
    }
    return page(eventTabs(event)+card(`<h1>Encerrar evento?</h1><h2>${esc(event.name)}</h2><p>As inscrições e o check-in serão fechados. Inscritos que não confirmaram presença passarão a constar como ausentes. Os participantes e certificados serão mantidos.</p><p>Para apenas pausar inscrições ou check-in, use os botões do painel.</p>${form(path,hidden('confirm','yes')+button('Confirmar encerramento do evento'))}<p><a href="/admin/eventos/${event.id}/painel">Cancelar e voltar</a></p>`));
  }
  const eventAdminMatch=path.match(/^\/admin\/eventos\/(\d+)$/);
  if(eventAdminMatch){
    let event=await query('SELECT * FROM events WHERE id=?',eventAdminMatch[1]).first();
    if(!event)return new Response('Evento não encontrado',{status:404});
    if(data){
      const values=await readEvent(data,event);
      if(values.error)return notice('Confira o evento',values.error,400);
      await query('UPDATE events SET name=?,date=?,location=?,start_time=?,end_time=?,description=?,capacity=?,registrations_open=?,image_base64=?,image_type=?,waitlist_enabled=?,finished=CASE WHEN ?=1 THEN 0 ELSE finished END WHERE id=?',...values.params,values.params[7],event.id).run();
      return redirect(path+'?salvo=1');
    }
    const link=(await invitationPreview(event,url.origin)).url;
    return page(eventTabs(event,'invite')+card(`${url.searchParams.has('salvo')?'<p class="notice">Evento salvo.</p>':''}<h1>${esc(event.name)}</h1><h2>Convite e dados</h2><label>Link para compartilhar<input readonly value="${esc(link)}"></label><p><a href="/eventos/${event.id}">Abrir convite</a> · <a href="https://wa.me/?text=${encodeURIComponent('Você é nosso convidado! '+event.name+' — Inscreva-se: '+link)}" target="_blank" rel="noopener noreferrer">Compartilhar pelo WhatsApp</a></p><img class="qr" src="/eventos/${event.id}/qr.svg" alt="QR para inscrição"><p><a href="/eventos/${event.id}/qr.svg" download="convite-somaforce.svg">Baixar QR do convite</a></p>${form(path,eventFields(event)+button('Salvar evento'),true)}<p><a href="/admin/eventos/${event.id}/painel">Voltar ao painel do evento</a></p>`));
  }
  if(path==='/admin'&&data){
    const action=data.get('action');
    if(action==='event'){
      const values=await readEvent(data,{});
      if(values.error)return notice('Confira o evento',values.error,400);
      const created=await query('INSERT INTO events(id,name,date,location,start_time,end_time,description,capacity,registrations_open,image_base64,image_type,waitlist_enabled) SELECT COALESCE(MAX(event_id),0)+1,?,?,?,?,?,?,?,?,?,?,? FROM (SELECT id AS event_id FROM events UNION ALL SELECT event_id FROM retired_events) RETURNING id',...values.params).first();
      return redirect('/admin/eventos/'+created.id+'/painel');
    }
    if(['activate','close','open_registrations','close_registrations'].includes(action)){
      const id=data.get('id')||'';
      if(!/^\d+$/.test(id)||!await query('SELECT id FROM events WHERE id=?',id).first())return new Response('Evento não encontrado',{status:404});
      if(action==='activate')await env.DB.batch([query('UPDATE events SET active=0'),query('UPDATE events SET active=1,finished=0 WHERE id=?',id)]);
      if(action==='close')await query('UPDATE events SET active=0 WHERE id=?',id).run();
      if(action==='open_registrations')await query('UPDATE events SET registrations_open=1,finished=0 WHERE id=?',id).run();
      if(action==='close_registrations')await query('UPDATE events SET registrations_open=0 WHERE id=?',id).run();
      return redirect(data.get('return_to')==='/admin'?'/admin':'/admin/eventos/'+id+'/painel');
    }
    if(action==='telegram'){
      const token=(data.get('token')||'').trim(),chat=(data.get('chat')||'').trim();
      if(token&&!/^\d+:[A-Za-z0-9_-]{20,100}$/.test(token))return new Response('Token inválido',{status:400});
      if(chat&&!/^-?\d{1,25}$|^@[A-Za-z0-9_]{5,64}$/.test(chat))return new Response('Chat inválido',{status:400});
      const statements=[set('telegram_chat',chat),set('telegram_enabled',data.get('enabled')==='yes'&&chat?'1':'0')];
      if(token)statements.push(set('telegram_token',token));
      if(data.get('clear')==='yes')statements.push(set('telegram_token',''),set('telegram_enabled','0'));
      await env.DB.batch([...statements,query("INSERT INTO audit_log(action,label) VALUES ('settings_updated','Configurações do Telegram')")]);
    }
    if(action==='telegram')return redirect('/admin/configuracoes?salvo=1');
    if(action==='retry'&&/^[a-f0-9]{64}$/.test(data.get('token')||''))ctx.waitUntil(notify(env,data.get('token'),data.get('kind')==='inscricao'?'inscricao':'checkin'));
    if(/^\d+$/.test(data.get('return_event')||''))return redirect('/admin/eventos/'+data.get('return_event')+'/participantes');
    return redirect('/admin');
  }
  if(path==='/admin/export.pdf'){
    const search=searchFilter(url.searchParams.get('q'));
    const rows=(await query(participantSelect+' WHERE '+filterClause+search.clause+' ORDER BY e.id,r.company,r.name',...filterParams(url),...search.params).all()).results;
    const eventId=url.searchParams.get('event')||'';
    const event=eventId?await query('SELECT name FROM events WHERE id=?',eventId).first():null;
    if(eventId&&!event)return new Response('Evento não encontrado',{status:404});
    const bytes=await createParticipantPdf({rows,eventName:event?.name||'Todos os eventos',status:url.searchParams.get('status')||'',logoBase64});
    return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="eventos-lista-participantes.pdf"'}});
  }
  if(path==='/admin/export.csv'){
    const search=searchFilter(url.searchParams.get('q'));
    const rows=(await query(participantSelect+' WHERE '+filterClause+search.clause+' ORDER BY r.id',...filterParams(url),...search.params).all()).results;
    const cell=value=>'"'+(/^[=+@\-\t\r\n]/.test(String(value))?"'":'')+String(value??'').replaceAll('"','""')+'"';
    const records=[['Evento','Empresa','Nome','Telefone','Situação','Inscrição UTC','Check-in UTC','Origem','Telegram inscrição','Telegram presença'],...rows.map(row=>[row.event,row.company,row.name,row.phone,statusOf(row),row.created,row.checked_in_at,row.source,row.enrollment_telegram,row.telegram])];
    return new Response('\ufeff'+records.map(row=>row.map(cell).join(';')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="eventos-participantes.csv"'}});
  }
  if(request.method==='GET'&&path.startsWith('/admin')){
    const adminPage=await handleAdminPages({path,url,env,participantSelect,filterClause});
    if(adminPage)return adminPage;
  }
  const publicEventMatch=path.match(/^\/eventos\/(\d+)(?:\/(imagem|qr\.svg))?$/);
  if(publicEventMatch){
    const event=await query('SELECT e.*,(SELECT count(*) FROM registrations WHERE event_id=e.id AND waitlisted=0) AS total FROM events e WHERE id=?',publicEventMatch[1]).first();
    if(!event)return new Response('Evento não encontrado',{status:404});
    if(publicEventMatch[2]==='imagem')return event.image_base64?new Response(Uint8Array.from(atob(event.image_base64),char=>char.charCodeAt(0)),{headers:{'Content-Type':event.image_type}}):new Response('Sem imagem',{status:404});
    if(publicEventMatch[2]==='qr.svg')return qrResponse(url.origin+'/eventos/'+event.id);
    if(data){
      const values=personData(data);
      if(!values)return notice('Confira seus dados','Preencha empresa, nome e telefone válido com DDD e confirme o uso dos dados. Empresa e nome devem ter de 2 a 120 caracteres.',400);
      const duplicate=()=>notice('Este telefone já está inscrito neste evento','Seu cadastro anterior foi mantido, sem duplicação. No dia do evento, leia o QR permanente no local e informe o mesmo telefone para confirmar sua presença. Para corrigir seus dados, procure a organização. <a href="'+path+'">Voltar ao convite</a>');
      if(await query('SELECT id FROM registrations WHERE event_id=? AND phone=?',event.id,values[2]).first())return duplicate();
      const token=random();
      const reminderConsent=await get('reminders_enabled')==='1'&&data.get('reminder_opt_in')==='yes'?1:0;
      const created=await query("INSERT INTO registrations(event_id,company,name,phone,token,checked_in_at,source,telegram,enrollment_telegram,waitlisted,waitlisted_at,reminder_opt_in) SELECT e.id,?,?,?,?,NULL,'antecipada','aguardando','pendente',CASE WHEN e.capacity IS NOT NULL AND e.capacity<=(SELECT count(*) FROM registrations WHERE event_id=e.id AND waitlisted=0) THEN 1 ELSE 0 END,CASE WHEN e.capacity IS NOT NULL AND e.capacity<=(SELECT count(*) FROM registrations WHERE event_id=e.id AND waitlisted=0) THEN CURRENT_TIMESTAMP ELSE NULL END,? FROM events e WHERE e.id=? AND e.registrations_open=1 AND e.finished=0 AND (e.capacity IS NULL OR e.capacity>(SELECT count(*) FROM registrations WHERE event_id=e.id AND waitlisted=0) OR e.waitlist_enabled=1) ON CONFLICT(event_id,phone) DO NOTHING RETURNING id",...values,token,reminderConsent,event.id).first();
      if(!created){if(await query('SELECT id FROM registrations WHERE event_id=? AND phone=?',event.id,values[2]).first())return duplicate();return notice('Não foi possível inscrever','As inscrições podem estar fechadas ou as vagas esgotadas. Procure a organização. <a href="'+path+'">Voltar ao convite</a>');}
      ctx.waitUntil(notify(env,token,'inscricao'));
      return redirect('/entrada/'+token);
    }
    return invite(event,await get('telegram_enabled')==='1',await get('reminders_enabled')==='1',await invitationPreview(event,url.origin));
  }
  if(path==='/eventos'){
    const events=(await query('SELECT id,name,date,location,start_time,end_time FROM events WHERE registrations_open=1 AND finished=0 ORDER BY date,start_time').all()).results;
    return page('<p class="eyebrow">GESTÃO DE EVENTOS</p><h1>Próximos encontros</h1><div class="grid">'+(events.map(event=>card(`<h2>${esc(event.name)}</h2>${eventDetails(event)}<a class="action-link" href="/eventos/${event.id}">Ver convite e inscrever-se →</a>`)).join('')||'<p>Novos convites serão divulgados em breve.</p>')+'</div>');
  }
  const ticketMatch=path.match(/^\/entrada\/([a-f0-9]{64})(?:\/(qr\.svg))?$/);
  if(ticketMatch){
    const row=await query(participantSelect+' WHERE r.token=?',ticketMatch[1]).first();
    if(!row)return new Response('Inscrição não encontrada',{status:404});
    if(ticketMatch[2])return new Response('QR individual desativado. Use o QR permanente no local do evento.',{status:404});
    return ticket(row,url.origin);
  }
  if(path.startsWith('/certificados/')){
    const row=await query(participantSelect+' WHERE r.token=?',path.split('/')[2]).first();
    if(!row)return new Response('Não encontrado',{status:404});
    return page(card(`<p class="eyebrow">${esc(statusOf(row))}</p><h1>${esc(row.name)}</h1><h2>${esc(row.event)}</h2><p>${row.checked_in_at?'Seu check-in foi registrado.':'A inscrição não confirma presença. No dia do evento, leia o QR permanente no local e confirme sua presença com o telefone da inscrição.'}</p><h2>Seu espaço de certificados</h2><p>A emissão em PDF será disponibilizada em uma segunda etapa neste mesmo link, conforme as regras de presença definidas pela organização.</p><a href="/entrada/${row.token}">Ver minha inscrição</a>`));
  }
  if(path==='/'){
    const event=await query('SELECT * FROM events WHERE active=1').first();
    if(data){
      if(!event||String(event.id)!==data.get('event_id'))return notice('O evento mudou ou foi encerrado','Confira o evento atual e envie novamente. <a href="/">Atualizar formulário</a>');
      const phone=phoneOf(data.get('phone'));
      if(!/^\d{10,15}$/.test(phone)||data.get('consent')!=='yes')return notice('Confira seus dados','Informe um telefone válido com DDD e confirme o uso dos dados.',400);
      async function confirmExisting(existing){
        if(existing.waitlisted)return notice('Você está na lista de espera','A organização precisa liberar sua vaga antes do check-in. Procure a equipe do evento.',409);
        const changed=await query("UPDATE registrations SET checked_in_at=CURRENT_TIMESTAMP,telegram='pendente' WHERE id=? AND waitlisted=0 AND checked_in_at IS NULL AND EXISTS(SELECT 1 FROM events WHERE id=registrations.event_id AND active=1) RETURNING token",existing.id).first();
        if(!changed&&!existing.checked_in_at)return notice('O evento mudou ou foi encerrado','Confira o evento atual antes de confirmar presença. <a href="/">Atualizar formulário</a>',409);
        if(changed){ctx.waitUntil(notify(env,existing.token));ctx.waitUntil(ensureCertificate(env,existing.token).catch(()=>null));}
        return redirect('/certificados/'+existing.token);
      }
      const existing=await query('SELECT id,token,checked_in_at,waitlisted FROM registrations WHERE event_id=? AND phone=?',event.id,phone).first();
      if(existing)return confirmExisting(existing);
      const values=personData(data);
      if(!values)return page(card('<h2>Complete seu cadastro para este evento</h2><p>Não encontramos inscrição neste evento com o telefone informado. Preencha empresa, nome e telefone para confirmar sua presença. Todos os campos são obrigatórios.</p>'+newCheckinForm(event,phone,await get('telegram_enabled')==='1')+'<p><a href="/">Voltar e conferir o telefone</a></p>'));
      const token=random();
      const created=await query("INSERT INTO registrations(event_id,company,name,phone,token,checked_in_at,source) SELECT ?,?,?,?,?,CURRENT_TIMESTAMP,'presencial' WHERE EXISTS(SELECT 1 FROM events WHERE id=? AND active=1 AND (capacity IS NULL OR capacity>(SELECT count(*) FROM registrations WHERE event_id=? AND waitlisted=0))) ON CONFLICT(event_id,phone) DO NOTHING RETURNING id",event.id,...values,token,event.id,event.id).first();
      if(!created){
        const concurrent=await query('SELECT id,token,checked_in_at,waitlisted FROM registrations WHERE event_id=? AND phone=?',event.id,phone).first();
        if(concurrent)return confirmExisting(concurrent);
        return notice('Evento indisponível','O check-in pode estar fechado ou as vagas esgotadas. Procure a organização.',409);
      }
      ctx.waitUntil(notify(env,token));
      ctx.waitUntil(ensureCertificate(env,token).catch(()=>null));
      return redirect('/certificados/'+token);
    }
    const telegram=await get('telegram_enabled')==='1';
    return checkinHome(event,telegram);
  }
  return new Response('Não encontrado',{status:404});
}

function personData(data){
  const company=(data.get('company')||'').trim(),name=(data.get('name')||'').trim(),phone=phoneOf(data.get('phone'));
  return company.length>=2&&company.length<=120&&name.length>=2&&name.length<=120&&/^\d{10,15}$/.test(phone)&&data.get('consent')==='yes'?[company,name,phone]:null;
}
async function readEvent(data,previous){
  const text=name=>String(data.get(name)||'').trim();
  const name=text('name'),date=text('date'),location=text('location'),start=text('start_time'),end=text('end_time'),description=text('description'),capacityText=text('capacity');
  const capacity=capacityText?Number(capacityText):null;
  if(name.length<2||name.length>120||location.length<2||location.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||description.length>4000)return {error:'Informe nome, data e local válidos. A descrição pode ter até 4.000 caracteres.'};
  if([start,end].some(value=>value&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))||(start&&end&&end<start))return {error:'Confira os horários de início e término.'};
  if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1||capacity>100000))return {error:'O limite deve ser um número inteiro entre 1 e 100.000.'};
  let image=previous.image_base64||null,type=previous.image_type||null;
  if(data.get('remove_image')==='yes'){image=null;type=null;}
  const file=data.get('image');
  if(file&&typeof file!=='string'&&file.size){
    if(file.size>500000)return {error:'A imagem pode ter até 500 KB.'};
    const bytes=new Uint8Array(await file.arrayBuffer());
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    type=png?'image/png':jpeg?'image/jpeg':webp?'image/webp':null;
    if(!type)return {error:'Use uma imagem PNG, JPG ou WebP válida.'};
    let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.slice(offset,offset+8192));
    image=btoa(binary);
  }
  return {params:[name,date,location,start,end,description,capacity,data.get('registrations_open')==='yes'?1:0,image,type,data.get('waitlist_enabled')==='yes'?1:0]};
}
