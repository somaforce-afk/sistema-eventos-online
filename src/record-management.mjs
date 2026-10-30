export const normalizePhone=value=>{let phone=String(value||'').replace(/\D/g,'');if((phone.length===12||phone.length===13)&&phone.startsWith('55'))phone=phone.slice(2);return phone;};
export const certificateMetadata="c.pdf_base64 IS NOT NULL AS certificate_issued,c.last_error AS certificate_error,c.attempted_at,e.certificate_enabled,e.certificate_template_id,e.certificate_hours,t.id AS template_exists,json_extract(t.config_json,'$.body') AS template_body";
export const certificateJoins=' LEFT JOIN certificates c ON c.registration_id=r.id LEFT JOIN certificate_templates t ON t.id=e.certificate_template_id';
export const certificateStateSql="CASE WHEN r.waitlisted=1 OR r.checked_in_at IS NULL THEN 'not_present' WHEN c.pdf_base64 IS NOT NULL THEN 'issued' WHEN e.certificate_enabled=0 OR e.certificate_template_id IS NULL OR t.id IS NULL OR (instr(coalesce(json_extract(t.config_json,'$.body'),''),'carga_horaria')>0 AND e.certificate_hours='') THEN 'configuration' WHEN c.last_error IS NOT NULL THEN 'error' ELSE 'pending' END";
export function searchFilter(value){
  const raw=String(value||'').trim().slice(0,120);
  let term=raw.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  if(/^[+\d\s().-]+$/.test(raw))term=normalizePhone(raw);
  let expression="r.name||' '||r.company||' '||r.phone";
  for(const letter of 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ')expression="replace("+expression+",'"+letter+"','"+letter.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()+"')";
  return {raw,clause:term?' AND instr(lower('+expression+'),?)>0':'',params:term?[term]:[]};
}
export function certificateState(row){
  if(row.waitlisted)return {key:'not_present',label:'Lista de espera',reason:'A organização precisa liberar a vaga antes da presença.'};
  if(!row.checked_in_at)return {key:'not_present',label:'Aguardando presença',reason:'Inscrição sem presença confirmada.'};
  if(row.certificate_issued)return {key:'issued',label:'Emitido',reason:'PDF disponível no link individual.'};
  if(!row.certificate_enabled||!row.certificate_template_id||!row.template_exists)return {key:'configuration',label:'Configuração pendente',reason:'Escolha um modelo e ative a emissão neste evento.'};
  if(row.template_body?.includes('carga_horaria')&&!row.certificate_hours)return {key:'configuration',label:'Carga horária pendente',reason:'Informe a duração real na configuração do evento.'};
  if(row.certificate_error)return {key:'error',label:'Falha na emissão',reason:row.certificate_error};
  return {key:'pending',label:'Pronto para emitir',reason:'Presença confirmada. O PDF será gerado ao emitir ou baixar.'};
}
const registrationFields=['id','event_id','company','name','phone','token','created','telegram','checked_in_at','source','enrollment_telegram','revision','waitlisted','waitlisted_at','promoted_at','reminder_opt_in'];
const certificateFields=['registration_id','template_version','pdf_path','issued_at','pdf_base64','code','last_error','attempted_at'];
const eventFields=['id','name','date','location','active','start_time','end_time','description','capacity','registrations_open','finished','image_base64','image_type','certificate_template_id','certificate_enabled','certificate_hours','certificate_title','certificate_location','waitlist_enabled','reminder_template'];
const jsonObject=(fields,alias)=>'json_object('+fields.flatMap(key=>["'"+key+"'",alias+'.'+key]).join(',')+')';
export async function archiveRecords(env,kind,row){
  const id=crypto.randomUUID(),q=(sql,...params)=>env.DB.prepare(sql).bind(...params),eventId=kind==='event'?row.id:row.event_id;
  const predicate=kind==='event'?"r.event_id=?":"r.token=?",value=kind==='event'?row.id:row.token;
  const eligible=kind==='event'?"EXISTS(SELECT 1 FROM events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM registrations WHERE event_id=? AND (telegram='enviando' OR enrollment_telegram='enviando'))":"EXISTS(SELECT 1 FROM registrations WHERE token=? AND telegram!='enviando' AND enrollment_telegram!='enviando')";
  const condition=kind==='event'?[row.id,row.id]:[row.token];
  const statements=[q('INSERT INTO trash_batches(id,kind,event_id,label) SELECT ?,?,?,? WHERE '+eligible,id,kind,eventId,row.name,...condition)];
  if(kind==='event')statements.push(q('INSERT INTO trash_events SELECT ?,'+jsonObject(eventFields,'e')+' FROM events e WHERE e.id=? AND EXISTS(SELECT 1 FROM trash_batches WHERE id=?)',id,row.id,id));
  statements.push(q('INSERT INTO trash_registrations SELECT ?,r.id,'+jsonObject(registrationFields,'r')+' FROM registrations r WHERE '+predicate+' AND EXISTS(SELECT 1 FROM trash_batches WHERE id=?)',id,value,id));
  statements.push(q('INSERT INTO trash_certificates SELECT ?,c.registration_id,'+jsonObject(certificateFields,'c')+' FROM certificates c JOIN registrations r ON r.id=c.registration_id WHERE '+predicate+' AND EXISTS(SELECT 1 FROM trash_batches WHERE id=?)',id,value,id));
  statements.push(q('INSERT INTO audit_log(operation_id,event_id,participant_token,action,label,details_json) SELECT ?,?,?,?,?,json_object(\'trash_id\',?) WHERE EXISTS(SELECT 1 FROM trash_batches WHERE id=?)',id,eventId,kind==='participant'?row.token:null,kind+'_deleted',row.name,id,id));
  if(kind==='event')statements.push(q('INSERT INTO retired_events(event_id) SELECT ? WHERE EXISTS(SELECT 1 FROM trash_batches WHERE id=?) ON CONFLICT(event_id) DO NOTHING',row.id,id));
  statements.push(q('DELETE FROM certificates WHERE registration_id IN (SELECT registration_id FROM trash_registrations WHERE batch_id=?)',id));
  statements.push(q('DELETE FROM registrations WHERE token IN (SELECT json_extract(record_json,\'$.token\') FROM trash_registrations WHERE batch_id=?)',id));
  if(kind==='event')statements.push(q('DELETE FROM events WHERE id=? AND EXISTS(SELECT 1 FROM trash_batches WHERE id=?)',row.id,id));
  await env.DB.batch(statements);
  if(!await q('SELECT id FROM trash_batches WHERE id=?',id).first())throw new Error('O registro mudou ou há envio em andamento. Atualize a página e tente novamente.');
  return id;
}
export async function restoreRecords(env,id){
  const q=(sql,...params)=>env.DB.prepare(sql).bind(...params),batch=await q('SELECT * FROM trash_batches WHERE id=?',id).first();
  if(!batch)throw new Error('Exclusão não encontrada.');
  if(batch.restored_at)throw new Error('Este item já foi restaurado.');
  const event=await q('SELECT * FROM events WHERE id=?',batch.event_id).first();
  if(batch.kind==='event'&&event)throw new Error('Já existe um evento com este identificador. Nenhum dado foi substituído.');
  if(batch.kind==='participant'&&!event)throw new Error('Restaure primeiro o evento ao qual este participante pertence.');
  const conflict=await q("SELECT r.id FROM registrations r JOIN trash_registrations t ON r.token=json_extract(t.record_json,'$.token') OR (r.event_id=json_extract(t.record_json,'$.event_id') AND r.phone=json_extract(t.record_json,'$.phone')) WHERE t.batch_id=? LIMIT 1",id).first();
  if(conflict)throw new Error('Já existe cadastro com esse telefone neste evento. Corrija o conflito antes de restaurar; nenhum cadastro será substituído.');
  if(batch.kind==='participant'&&event.capacity!==null){const count=await q('SELECT count(*) n FROM registrations WHERE event_id=? AND waitlisted=0',event.id).first();const seats=await q("SELECT count(*) n FROM trash_registrations WHERE batch_id=? AND coalesce(json_extract(record_json,'$.waitlisted'),0)=0",id).first();if(count.n+seats.n>event.capacity)throw new Error('O evento está lotado. Aumente as vagas antes de restaurar o participante.');}
  const eligible="EXISTS(SELECT 1 FROM trash_batches WHERE id=? AND restored_at IS NULL AND restoring=1)";
  const statements=[q("UPDATE trash_batches SET restoring=1 WHERE id=? AND restored_at IS NULL AND (kind='event' OR EXISTS(SELECT 1 FROM events e WHERE e.id=trash_batches.event_id AND (e.capacity IS NULL OR e.capacity>=(SELECT count(*) FROM registrations WHERE event_id=e.id AND waitlisted=0)+(SELECT count(*) FROM trash_registrations WHERE batch_id=? AND coalesce(json_extract(record_json,'$.waitlisted'),0)=0))))",id,id)];
  if(batch.kind==='event')statements.push(q('INSERT INTO events('+eventFields.join(',')+') SELECT '+eventFields.map(key=>key==='active'||key==='registrations_open'?'0':key==='waitlist_enabled'?"coalesce(json_extract(record_json,'$.waitlist_enabled'),0)":key==='reminder_template'?"coalesce(json_extract(record_json,'$.reminder_template'),'')":"json_extract(record_json,'$."+key+"')").join(',')+' FROM trash_events WHERE batch_id=? AND '+eligible,id,id));
  const restoredFields=registrationFields.filter(key=>key!=='id');
  statements.push(q('INSERT INTO registrations('+restoredFields.join(',')+') SELECT '+restoredFields.map(key=>key==='revision'?"coalesce(json_extract(record_json,'$.revision'),1)+1":['waitlisted','reminder_opt_in'].includes(key)?"coalesce(json_extract(record_json,'$."+key+"'),0)":"json_extract(record_json,'$."+key+"')").join(',')+' FROM trash_registrations WHERE batch_id=? AND '+eligible,id,id));
  statements.push(q('INSERT INTO certificates('+certificateFields.join(',')+') SELECT r.id,'+certificateFields.slice(1).map(key=>"json_extract(c.record_json,'$."+key+"')").join(',')+" FROM trash_certificates c JOIN trash_registrations t ON t.batch_id=c.batch_id AND t.registration_id=c.registration_id JOIN registrations r ON r.token=json_extract(t.record_json,'$.token') WHERE c.batch_id=? AND "+eligible,id,id));
  statements.push(q('INSERT INTO audit_log(event_id,action,label,details_json) SELECT event_id,\'records_restored\',label,json_object(\'trash_id\',id) FROM trash_batches WHERE id=? AND restored_at IS NULL AND restoring=1',id));
  statements.push(q('UPDATE trash_batches SET restored_at=CURRENT_TIMESTAMP,restoring=0 WHERE id=? AND restored_at IS NULL AND restoring=1',id));
  await env.DB.batch(statements);
  if(!(await q('SELECT restored_at FROM trash_batches WHERE id=?',id).first())?.restored_at)throw new Error('O evento mudou ou as vagas foram preenchidas durante a restauração. Confira o evento e tente novamente.');
  return batch;
}
