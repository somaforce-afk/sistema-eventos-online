import {esc,hidden,field,button,form,card,page,notice,redirect} from './ui.mjs';
import {eventTabs} from './admin-pages.mjs';
import {normalizePhone,restoreRecords,searchFilter,certificateState,certificateMetadata,certificateJoins,certificateStateSql} from './record-management.mjs';
import {ensureCertificate,fromBase64,toBase64} from './certificates.mjs';
import {reviseIssuedCertificate} from './certificate-text.mjs';
const names={event_duplicated:'Evento duplicado',waitlist_joined:'Entrada na lista de espera',waitlist_promoted:'Vaga liberada',event_options_updated:'Opções do evento atualizadas',reminder_marked:'Lembrete marcado como enviado',reminders_configured:'Lembretes configurados',reception_toggled:'Acesso da recepção alterado',staff_updated:'Acesso de recepcionista atualizado',settings_updated:'Configuração geral salva',model_created:'Modelo de certificado adicionado',model_updated:'Modelo de certificado atualizado',enrollment_created:'Inscrição registrada',presence_confirmed:'Presença confirmada',event_created:'Evento criado',event_updated:'Evento atualizado',participant_edited:'Cadastro corrigido',participant_deleted:'Participante enviado à Lixeira',event_deleted:'Evento enviado à Lixeira',records_restored:'Dados restaurados',certificate_issued:'Certificado emitido',certificate_failed:'Falha na emissão do certificado'};
function historyDetails(row){
  const data=JSON.parse(row.details_json||'{}');
  const labels={name:'Nome',company:'Empresa',phone:'Telefone',reminder_opt_in:'Autorização de lembretes',date:'Data',location:'Local',start_time:'Início',end_time:'Término',capacity:'Vagas',active:'Check-in',registrations_open:'Inscrições',finished:'Evento encerrado',certificate_template:'Modelo do certificado',certificate_enabled:'Emissão de certificados',certificate_hours:'Carga horária',certificate_title:'Treinamento no certificado',certificate_location:'Local no certificado'};
  const display=(key,value)=>value===null||value===''?'Não informado':['reminder_opt_in','active','registrations_open','finished','certificate_enabled'].includes(key)?value?'Sim':'Não':String(value);
  let content='';
  if(data.before&&data.after){
    const changed=Object.keys(labels).filter(key=>key in data.before&&data.before[key]!==data.after[key]);
    content=changed.length?'<table><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr>'+changed.map(key=>'<tr><td>'+labels[key]+'</td><td>'+esc(key==='certificate_template'?'Modelo anterior':display(key,data.before[key]))+'</td><td>'+esc(key==='certificate_template'?'Modelo atualizado':display(key,data.after[key]))+'</td></tr>').join('')+'</table>':'<p>Dados do registro atualizados.</p>';
  }else if(data.source_event)content='<p>Evento de origem: '+esc(data.source_event)+'</p>';
  else if(data.reminder_changed)content='<p>Texto do lembrete atualizado.</p>';
  else if('waitlist_after' in data)content='<p>Lista de espera '+(data.waitlist_after?'ativada':'desativada')+'.</p>';
  else if(data.reason)content='<p>'+esc(data.reason)+'</p>';
  else if(data.company||data.phone)content='<p>Empresa: '+esc(data.company)+'<br>Telefone: '+esc(data.phone)+'<br>Origem: '+(data.source==='antecipada'?'Inscrição antecipada':'Cadastro no dia')+'</p>';
  else if(data.revision_after)content='<p>Versão do modelo: '+esc(data.revision_before)+' → '+esc(data.revision_after)+'</p>';
  else if(data.revision)content='<p>Versão do modelo: '+esc(data.revision)+'</p>';
  else if(data.trash_id)content='<p><a href="/admin/lixeira">Consultar Lixeira e recuperação</a></p>';
  if(data.certificate_updated)content+='<p>O nome também foi corrigido no certificado.</p>';
  if(data.image_changed)content+='<p>Imagem do evento alterada.</p>';
  return content?'<details><summary>Ver detalhes</summary>'+content+'</details>':'';
}

export async function handleParticipantActions({path,url,env,data}){
  const q=(sql,...params)=>env.DB.prepare(sql).bind(...params);
  const edit=path.match(/^\/admin\/participantes\/([a-f0-9]{64})\/(editar|certificado)$/);
  if(edit){
    const row=await q('SELECT r.*,e.name AS event FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.token=?',edit[1]).first();
    if(!row)return new Response('Participante não encontrado',{status:404});
    const base='/admin/eventos/'+row.event_id,back='<p><a href="'+base+'/participantes">Voltar aos participantes</a></p>';
    if(edit[2]==='certificado'){
      if(!data)return new Response('Use o botão Emitir na lista de certificados.',{status:405});
      if(row.waitlisted||!row.checked_in_at)return notice('Presença necessária','Confirme a presença antes de emitir.'+back,409);
      try{const result=await ensureCertificate(env,row.token);if(!result?.pdf_base64)return notice('Configuração pendente','Escolha um modelo e ative o certificado deste evento.'+back,409);return redirect(base+'/certificados?emitido=1');}
      catch(error){return notice('Revise a pendência',esc(error.message)+'<p><a href="'+base+'/certificados">Voltar ao controle de certificados</a></p>',422);}
    }
    if(data){
      const next={reminder_opt_in:data.get('reminder_opt_in')==='yes'?1:0,name:String(data.get('name')||'').trim(),company:String(data.get('company')||'').trim(),phone:normalizePhone(data.get('phone'))};
      if(next.name.length<2||next.name.length>120||next.company.length<2||next.company.length>120||!/^\d{10,15}$/.test(next.phone))return notice('Confira os dados','Empresa, nome e telefone com DDD são obrigatórios. Use de 2 a 120 caracteres nos campos de texto.'+back,400);
      if(Number(data.get('revision'))!==row.revision)return notice('Cadastro atualizado por outra operação','Reabra a edição antes de salvar para evitar substituir uma alteração recente.'+back,409);
      if(row.telegram==='enviando'||row.enrollment_telegram==='enviando')return notice('Envio em andamento','Aguarde o envio ao Telegram antes de editar.'+back,409);
      if(await q('SELECT id FROM registrations WHERE event_id=? AND phone=? AND token!=?',row.event_id,next.phone,row.token).first())return notice('Telefone já cadastrado','Outro participante deste evento usa esse telefone. Confira o número; nenhum cadastro foi substituído.'+back,409);
      if(next.name===row.name&&next.company===row.company&&next.phone===row.phone&&next.reminder_opt_in===row.reminder_opt_in)return redirect(base+'/participantes?salvo=1');
      const cached=await q('SELECT pdf_base64 FROM certificates WHERE registration_id=?',row.id).first();
      let revised=cached?.pdf_base64||null;
      try{if(revised&&row.name!==next.name)revised=toBase64(await reviseIssuedCertificate(fromBase64(revised),row,next));}catch(error){return notice('Confira a correção do certificado',esc(error.message)+back,422);}
      if(revised?.length>950000)return notice('Certificado muito grande','O arquivo corrigido excedeu o tamanho permitido. Nenhum dado foi alterado.'+back,422);
      const operation=crypto.randomUUID(),details=JSON.stringify({before:{name:row.name,company:row.company,phone:row.phone,reminder_opt_in:row.reminder_opt_in},after:next,certificate_updated:revised!==cached?.pdf_base64&&!!revised});
      try{await env.DB.batch([
        q("INSERT INTO audit_log(operation_id,event_id,participant_token,action,label,details_json) SELECT ?,event_id,token,'participant_edited',?,? FROM registrations WHERE token=? AND revision=? AND telegram!='enviando' AND enrollment_telegram!='enviando' AND coalesce((SELECT pdf_base64 FROM certificates WHERE registration_id=registrations.id),'')=?",operation,next.name,details,row.token,row.revision,cached?.pdf_base64||''),
        q('UPDATE registrations SET name=?,company=?,phone=?,reminder_opt_in=?,revision=revision+1 WHERE token=? AND revision=? AND EXISTS(SELECT 1 FROM audit_log WHERE operation_id=?)',next.name,next.company,next.phone,next.reminder_opt_in,row.token,row.revision,operation),
        q('UPDATE certificates SET pdf_base64=?,last_error=NULL WHERE registration_id=? AND EXISTS(SELECT 1 FROM audit_log WHERE operation_id=?)',revised,row.id,operation)
      ]);}catch{return notice('Não foi possível salvar','O cadastro mudou ou o telefone entrou em conflito. Reabra a edição e confira os dados.'+back,409);}
      if(!await q('SELECT id FROM audit_log WHERE operation_id=?',operation).first())return notice('Cadastro em atualização','Outro processo alterou o cadastro ou o certificado. Reabra a edição e tente novamente.'+back,409);
      return redirect(base+'/participantes?salvo=1');
    }
    return page(eventTabs({id:row.event_id,name:row.event},'people')+card(`<h1>Editar participante</h1><p>A presença e o link individual serão mantidos. Corrigir o nome também corrige o certificado já emitido, mantendo o layout e o código. Empresa e telefone são atualizados no cadastro; os outros dados de PDFs já emitidos são preservados. As mensagens antigas do Telegram não são alteradas nem reenviadas.</p>${form(path,hidden('revision',row.revision)+field('Empresa (obrigatório)','company','text',row.company)+field('Nome completo (obrigatório)','name','text',row.name)+field('Telefone com DDD (obrigatório)','phone','tel',row.phone)+`<label class="check"><input type="checkbox" name="reminder_opt_in" value="yes" ${row.reminder_opt_in?'checked':''}>Participante autorizou receber lembretes deste evento pelo WhatsApp</label>`+button('Salvar correção'))}${back}`));
  }
  const history=path.match(/^\/admin\/eventos\/(\d+)\/historico$/);
  if(path==='/admin/historico'||history){
    const event=history?await q('SELECT id,name FROM events WHERE id=?',history[1]).first():null;
    if(history&&!event)return new Response('Evento não encontrado',{status:404});
    const before=Number(url.searchParams.get('antes')||0),eventId=event?.id||Number(url.searchParams.get('event')||0);
    const rows=(await q('SELECT * FROM audit_log WHERE (?=0 OR event_id=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT 100',eventId,eventId,before,before).all()).results;
    return page((event?eventTabs(event,'history'):'')+`<h1>Histórico${event?' do evento':''}</h1><p>As operações passam a ser registradas a partir desta atualização. Horários em UTC.</p><p><a href="/admin/lixeira${event?'?event='+event.id:''}">Abrir Lixeira</a></p>${card(rows.map(row=>`<article class="history-entry"><p><strong>${esc(names[row.action]||row.action)}</strong> · ${esc(row.actor_name||'Sistema')} · ${esc(row.created_at)} UTC</p><p>${esc(row.label)}</p>${historyDetails(row)}</article>`).join('')||'<p>Nenhuma alteração registrada neste filtro.</p>')}${rows.length===100?'<p><a href="'+path+'?antes='+rows.at(-1).id+(event?'':eventId?'&event='+eventId:'')+'">Ver registros anteriores</a></p>':''}`);
  }
  const restore=path.match(/^\/admin\/lixeira\/([a-f0-9-]{36})\/restaurar$/);
  if(path==='/admin/lixeira'||restore){
    const eventId=Number(url.searchParams.get('event')||0);
    if(restore){
      const item=await q('SELECT b.*,(SELECT count(*) FROM trash_registrations WHERE batch_id=b.id) AS people,(SELECT count(*) FROM trash_certificates WHERE batch_id=b.id) AS certificates FROM trash_batches b WHERE b.id=?',restore[1]).first();
      if(!item)return new Response('Item não encontrado',{status:404});
      if(data){
        if(data.get('confirm')!=='yes')return new Response('Confirmação necessária',{status:400});
        try{await restoreRecords(env,item.id);return redirect('/admin/lixeira?restaurado=1');}catch(error){return notice('Não foi possível restaurar',esc(/UNIQUE|constraint/i.test(error.message)?'Há um cadastro ou código de certificado em conflito. Nenhum dado foi substituído.':error.message)+' <a href="/admin/lixeira">Voltar à Lixeira</a>',409);}
      }
      if(item.restored_at)return notice('Item já restaurado','Este item já foi recuperado. <a href="/admin/lixeira">Voltar à Lixeira</a>');
      return page(card(`<h1>Restaurar ${item.kind==='event'?'evento':'participante'}?</h1><h2>${esc(item.label)}</h2><p>${item.people} participantes e ${item.certificates} registros de certificado serão recuperados com seus links originais.</p>${item.kind==='event'?'<p>O evento voltará com inscrições e check-in fechados. Abra-os depois, se necessário.</p>':''}${form(path,hidden('confirm','yes')+button('Restaurar dados'))}<p><a href="/admin/lixeira">Cancelar</a></p>`));
    }
    const items=(await q('SELECT b.*,(SELECT count(*) FROM trash_registrations WHERE batch_id=b.id) AS people FROM trash_batches b WHERE restored_at IS NULL AND (?=0 OR event_id=?) ORDER BY deleted_at DESC,id DESC LIMIT 200',eventId,eventId).all()).results;
    return page(`<h1>Lixeira</h1><p>Recupere exclusões realizadas a partir desta atualização. Exclusões antigas, feitas antes da Lixeira existir, não podem ser recuperadas aqui.</p>${url.searchParams.has('restaurado')?'<p class="notice">Dados restaurados com os links originais.</p>':''}${card(items.map(item=>`<div class="eventrow"><div><strong>${esc(item.label)}</strong><p>${item.kind==='event'?'Evento':'Participante'} · ${item.people} participantes · excluído em ${esc(item.deleted_at)} UTC</p></div><a href="/admin/lixeira/${item.id}/restaurar">Restaurar</a></div>`).join('')||'<p>Nenhum item excluído neste filtro.</p>')}<p><a href="/admin/historico">Ver histórico</a></p>`);
  }
  const certificates=path.match(/^\/admin\/eventos\/(\d+)\/certificados$/);
  if(certificates){
    const event=await q('SELECT * FROM events WHERE id=?',certificates[1]).first();if(!event)return new Response('Evento não encontrado',{status:404});
    const search=searchFilter(url.searchParams.get('q')),state=url.searchParams.get('situacao')||'';
    const rows=(await q('SELECT r.id,r.name,r.company,r.phone,r.token,r.checked_in_at,'+certificateMetadata+' FROM registrations r JOIN events e ON e.id=r.event_id'+certificateJoins+' WHERE r.event_id=? AND r.waitlisted=0'+search.clause+" AND (?='' OR "+certificateStateSql+'=?) ORDER BY r.name LIMIT 1001',event.id,...search.params,state,state).all()).results;
    const shown=rows.slice(0,1000).map(row=>({...row,state:certificateState(row)})).filter(row=>!state||row.state.key===state);
    const counts=await q('SELECT count(*) total,sum(CASE WHEN r.waitlisted=0 AND r.checked_in_at IS NOT NULL AND c.pdf_base64 IS NOT NULL THEN 1 ELSE 0 END) issued,sum(CASE WHEN r.checked_in_at IS NOT NULL AND c.pdf_base64 IS NULL THEN 1 ELSE 0 END) pending FROM registrations r LEFT JOIN certificates c ON c.registration_id=r.id WHERE r.event_id=? AND r.waitlisted=0',event.id).first();
    return page(eventTabs(event,'certificates')+`<h1>Certificados de ${esc(event.name)}</h1><div class="stats"><div><strong>${counts.issued||0}</strong>Emitidos</div><div><strong>${counts.pending||0}</strong>Presentes com pendência</div><div><strong>${counts.total}</strong>Participantes</div></div><p class="export-actions"><a href="/admin/certificados/eventos/${event.id}">Configurar modelo e carga horária</a><a class="action-link" href="/admin/certificados/eventos/${event.id}/imprimir">Baixar todos para imprimir ↓</a></p>${url.searchParams.has('emitido')?'<p class="notice">Certificado emitido.</p>':''}${card(`<form method="get" class="toolbar">${field('Buscar nome, empresa ou telefone','q','search',search.raw,false)}<label>Situação<select name="situacao">${[['','Todas'],['issued','Emitidos'],['pending','Prontos para emitir'],['configuration','Configuração pendente'],['error','Falha na emissão'],['not_present','Aguardando presença']].map(([key,label])=>`<option value="${key}" ${state===key?'selected':''}>${label}</option>`).join('')}</select></label>${button('Buscar')}</form><p>Até mil cadastros por busca. Use o nome, empresa ou telefone para localizar um participante.</p><div class="table"><table><tr><th>Participante</th><th>Empresa</th><th>Situação / Pendência</th><th>Ação</th></tr>${shown.map(row=>`<tr><td>${esc(row.name)}<small>${esc(row.phone)}</small></td><td>${esc(row.company)}</td><td><span class="badge">${esc(row.state.label)}</span><p>${esc(row.state.reason)}</p></td><td>${row.state.key==='issued'?'<a href="/certificados/'+row.token+'/baixar.pdf">Baixar PDF</a>':row.checked_in_at?form('/admin/participantes/'+row.token+'/certificado',button(row.state.key==='error'?'Tentar novamente':'Emitir certificado')):'Confirme a presença'}<p><a href="/admin/participantes/${row.token}/editar">Editar participante</a></p></td></tr>`).join('')||'<tr><td colspan="4">Nenhum participante neste filtro.</td></tr>'}</table></div>`)}`);
  }
  return null;
}
