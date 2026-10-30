import {esc,field,hidden,button,form,card,page,notice,redirect,eventDetails,statusOf} from './ui.mjs';
import {searchFilter} from './record-management.mjs';
export async function getStaffContext(request,env,hash){
  const token=request.headers.get('Cookie')?.match(/(?:^|; )sf_staff_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)return null;
  return env.DB.prepare("SELECT u.id,u.name,u.username,s.id AS session_id FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id WHERE s.id=? AND s.expires>unixepoch() AND u.enabled=1 AND EXISTS(SELECT 1 FROM settings WHERE key='reception_enabled' AND value='1')").bind(await hash(token)).first();
}
export async function handleReception({request,path,url,env,data,staff,hash,passwordHash,random,notify,ensureCertificate,ctx}){
  const q=(sql,...args)=>env.DB.prepare(sql).bind(...args);
  const get=async key=>(await q('SELECT value FROM settings WHERE key=?',key).first())?.value||'';
  const edit=path.match(/^\/admin\/equipe\/([a-f0-9-]{36})$/);
  if(path==='/admin/equipe'||edit){
    const users=(await q('SELECT id,name,username,enabled,last_login FROM staff_users ORDER BY name').all()).results;
    const events=(await q('SELECT id,name FROM events ORDER BY id DESC').all()).results;
    const selected=edit?users.find(user=>user.id===edit[1]):null;
    if(edit&&!selected)return new Response('Recepcionista não encontrado',{status:404});
    if(data){
      if(data.get('action')==='toggle'){
        const enabled=data.get('enabled')==='yes'?'1':'0';
        await env.DB.batch([q("INSERT INTO settings(key,value) VALUES('reception_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",enabled),q('DELETE FROM staff_sessions'),q("INSERT INTO audit_log(action,label,actor_name) VALUES('reception_toggled',?,'Organização')",enabled==='1'?'Recepção ativada':'Recepção desativada')]);
        return redirect('/admin/equipe?salvo=1');
      }
      const name=String(data.get('name')||'').trim(),username=String(data.get('username')||'').trim().toLowerCase(),password=String(data.get('password')||'');
      if(name.length<2||name.length>120||!/^[a-z0-9._-]{3,60}$/.test(username))return notice('Confira o recepcionista','Informe nome e usuário de 3 a 60 caracteres, com letras, números, ponto, traço ou sublinhado.',400);
      if((!selected||password)&&(password.length<12||password.length>128||password!==data.get('confirm_password')))return notice('Confira a senha','Use de 12 a 128 caracteres e repita a senha.',400);
      if(await q('SELECT id FROM staff_users WHERE username=? AND id!=?',username,selected?.id||'').first())return notice('Usuário já utilizado','Escolha outro nome de usuário.',409);
      const ids=[...new Set(data.getAll('event_id'))];if(ids.some(id=>!events.some(event=>String(event.id)===id)))return notice('Confira os eventos','Selecione apenas eventos existentes.',400);
      const id=selected?.id||crypto.randomUUID(),salt=password?random():'';
      const passwordValue=password?salt+':'+await passwordHash(password,salt):null,enabled=data.get('enabled')==='yes'?1:0;
      const statements=selected?[q('UPDATE staff_users SET name=?,username=?,enabled=?,password_hash=coalesce(?,password_hash) WHERE id=?',name,username,enabled,passwordValue,id)]:[q('INSERT INTO staff_users(id,name,username,password_hash,enabled) VALUES (?,?,?,?,?)',id,name,username,passwordValue,enabled)];
      statements.push(q('DELETE FROM staff_event_access WHERE staff_id=?',id),q('DELETE FROM staff_sessions WHERE staff_id=?',id));
      for(const eventId of ids)statements.push(q('INSERT INTO staff_event_access(staff_id,event_id) VALUES (?,?)',id,Number(eventId)));
      statements.push(q("INSERT INTO audit_log(action,label,actor_name) VALUES('staff_updated',?,'Organização')",name));
      await env.DB.batch(statements);return redirect('/admin/equipe/'+id+'?salvo=1');
    }
    const enabled=await get('reception_enabled')==='1';
    const access=selected?(await q('SELECT event_id FROM staff_event_access WHERE staff_id=?',selected.id).all()).results.map(row=>row.event_id):[];
    const editor=card(`<h2>${selected?'Editar recepcionista':'Novo recepcionista'}</h2>${form(selected?path:'/admin/equipe',field('Nome','name','text',selected?.name)+field('Usuário de acesso','username','text',selected?.username)+field(selected?'Nova senha (vazio para manter)':'Senha (mínimo 12 caracteres)','password','password','',!selected)+field('Repita a senha','confirm_password','password','',!selected)+`<label class="check"><input type="checkbox" name="enabled" value="yes" ${!selected||selected.enabled?'checked':''}>Permitir acesso deste recepcionista</label><fieldset><legend>Eventos permitidos</legend>${events.map(event=>`<label class="check"><input type="checkbox" name="event_id" value="${event.id}" ${access.includes(event.id)?'checked':''}>${esc(event.name)}</label>`).join('')||'<p>Crie um evento para conceder acesso.</p>'}</fieldset>`+button('Salvar recepcionista'))}`);
    return page(`<h1>Equipe de recepção</h1><p>Recurso opcional. O check-in atual pelo QR permanente e telefone continua disponível, independentemente desta opção. Recepcionistas podem consultar e confirmar presenças apenas nos eventos autorizados.</p>${url.searchParams.has('salvo')?'<p class="notice">Configuração salva. Acessos anteriores foram encerrados para aplicar as permissões.</p>':''}${card(`<h2>Recepção ${enabled?'ativada':'desativada'}</h2>${form('/admin/equipe',hidden('action','toggle')+`<label class="check"><input type="checkbox" name="enabled" value="yes" ${enabled?'checked':''}>Ativar o acesso da equipe de recepção</label>`+button('Aplicar ativação / desativação'))}<label>Link de acesso da equipe<input readonly value="${esc(url.origin+'/recepcao/login')}"></label><p>Ao desativar, todas as sessões da equipe são encerradas imediatamente. A senha administrativa não deve ser compartilhada.</p>`)}<div class="event-grid">${card('<h2>Recepcionistas</h2>'+users.map(user=>`<div class="eventrow"><div><strong>${esc(user.name)}</strong><p>${esc(user.username)} · ${user.enabled?'Permitido':'Bloqueado'}</p></div><a href="/admin/equipe/${user.id}">Editar acesso</a></div>`).join('')+'<p><a href="/admin/equipe">Cadastrar novo recepcionista</a></p>')}${editor}</div><p><a href="/admin/configuracoes">Voltar às configurações</a></p>`);
  }
  if(!path.startsWith('/recepcao'))return null;
  if(await get('reception_enabled')!=='1')return notice('Recepção desativada','O acesso da equipe está desativado pela organização. O check-in do participante continua no QR permanente. <a href="/">Abrir check-in</a>',403);
  if(path==='/recepcao/login'){
    if(staff)return redirect('/recepcao');
    if(data){const user=await q('SELECT * FROM staff_users WHERE username=? AND enabled=1',String(data.get('username')||'').trim().toLowerCase()).first();
      if(user){const [salt,expected]=user.password_hash.split(':');if(await passwordHash(String(data.get('password')||''),salt)===expected){const token=random();await env.DB.batch([q('INSERT INTO staff_sessions(id,staff_id,expires) VALUES (?,?,unixepoch()+28800)',await hash(token),user.id),q('UPDATE staff_users SET last_login=CURRENT_TIMESTAMP WHERE id=?',user.id)]);return new Response(null,{status:303,headers:{Location:'/recepcao','Set-Cookie':`sf_staff_session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`}});}}
    }
    return page(card(`<h1>Acesso da recepção</h1>${data?'<p class="notice">Usuário ou senha inválidos.</p>':''}${form(path,field('Usuário','username')+field('Senha','password','password')+button('Entrar'))}<p><a href="/">Check-in do participante</a></p>`));
  }
  if(!staff)return redirect('/recepcao/login');
  if(path==='/recepcao/sair'&&data){await q('DELETE FROM staff_sessions WHERE id=?',staff.session_id).run();return new Response(null,{status:303,headers:{Location:'/recepcao/login','Set-Cookie':'sf_staff_session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});}
  const nav=`<div class="toolbar"><p>Recepção: <strong>${esc(staff.name)}</strong> · <a href="/recepcao">Meus eventos</a></p>${form('/recepcao/sair',button('Sair'))}</div>`;
  if(path==='/recepcao'){
    const events=(await q('SELECT e.* FROM events e JOIN staff_event_access a ON a.event_id=e.id WHERE a.staff_id=? ORDER BY e.date',staff.id).all()).results;
    return page(nav+'<h1>Eventos da recepção</h1><div class="event-grid">'+(events.map(event=>card(`<h2>${esc(event.name)}</h2>${eventDetails(event)}<p>${event.active?'Check-in aberto':'Check-in fechado'}</p><a href="/recepcao/eventos/${event.id}">Consultar participantes</a>`)).join('')||card('<p>Nenhum evento autorizado. Procure a organização.</p>'))+'</div>');
  }
  const match=path.match(/^\/recepcao\/eventos\/(\d+)(?:\/confirmar\/([a-f0-9]{64}))?$/);
  if(!match)return new Response('Não encontrado',{status:404});
  const event=await q('SELECT e.* FROM events e JOIN staff_event_access a ON a.event_id=e.id WHERE e.id=? AND a.staff_id=?',match[1],staff.id).first();
  if(!event)return new Response('Evento não autorizado',{status:403});
  if(match[2]){
    const row=await q('SELECT * FROM registrations WHERE event_id=? AND token=?',event.id,match[2]).first();if(!row)return new Response('Participante não encontrado',{status:404});
    if(data){
      if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
      if(row.waitlisted)return notice('Vaga ainda não liberada','Este cadastro está na lista de espera. A organização precisa liberar a vaga antes do check-in.',409);
      const changed=await q("UPDATE registrations SET checked_in_at=CURRENT_TIMESTAMP,telegram='pendente' WHERE token=? AND event_id=? AND waitlisted=0 AND checked_in_at IS NULL AND EXISTS(SELECT 1 FROM events WHERE id=? AND active=1) AND EXISTS(SELECT 1 FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_id JOIN staff_event_access a ON a.staff_id=u.id WHERE s.id=? AND s.expires>unixepoch() AND u.enabled=1 AND a.event_id=registrations.event_id) AND EXISTS(SELECT 1 FROM settings WHERE key='reception_enabled' AND value='1') RETURNING id",row.token,event.id,event.id,staff.session_id).first();
      if(changed){await q("UPDATE audit_log SET actor_name=? WHERE id=(SELECT max(id) FROM audit_log WHERE participant_token=? AND action='presence_confirmed')",staff.name,row.token).run();ctx.waitUntil(notify(env,row.token));ctx.waitUntil(ensureCertificate(env,row.token).catch(()=>null));}
      else if(!row.checked_in_at)return notice('Check-in fechado','A organização precisa abrir o check-in deste evento.',409);
      return redirect('/recepcao/eventos/'+event.id+'?confirmado=1');
    }
    return page(nav+card(`<h1>Conferir entrada</h1><h2>${esc(row.name)}</h2><p>${esc(row.company)} · ${esc(row.phone)}</p><h3>${esc(event.name)}</h3><p>${esc(statusOf(row))}</p>${!row.checked_in_at&&!row.waitlisted&&event.active?form(path,hidden('confirm','yes')+button('Confirmar presença')):row.checked_in_at?'<p>Presença já confirmada. Não é necessário registrar novamente.</p>':'<p>A organização precisa abrir o check-in ou liberar a vaga.</p>'}<a href="/recepcao/eventos/${event.id}">Voltar aos participantes</a>`));
  }
  const search=searchFilter(url.searchParams.get('q'));const rows=(await q('SELECT r.* FROM registrations r WHERE r.event_id=?'+search.clause+' ORDER BY r.name LIMIT 100',event.id,...search.params).all()).results;
  return page(nav+`<h1>${esc(event.name)}</h1>${eventDetails(event)}${url.searchParams.has('confirmado')?'<p class="notice" role="status">Presença confirmada.</p>':''}${card(`<form method="get">${field('Nome, empresa ou telefone','q','search',search.raw,false)}${button('Buscar')}</form><p>Até cem registros por busca. Use os dados do participante para localizar sua entrada.</p><div class="table"><table><tr><th>Nome</th><th>Empresa / Telefone</th><th>Situação</th><th>Entrada</th></tr>${rows.map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(row.company)}<br>${esc(row.phone)}</td><td>${esc(statusOf(row))}</td><td><a href="/recepcao/eventos/${event.id}/confirmar/${row.token}">Conferir entrada</a></td></tr>`).join('')||'<tr><td colspan="4">Nenhum participante encontrado.</td></tr>'}</table></div>`)}`);
}
