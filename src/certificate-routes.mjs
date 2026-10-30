import {esc,hidden,field,button,form,card,page,notice,redirect,eventDetails} from './ui.mjs';
import {defaultCertificateBody,certificateTokens,certificateConfig,certificateAsset,renderCertificate,ensureCertificate,certificatePrintManifest,fromBase64} from './certificates.mjs';

const samplePerson={name:'PARTICIPANTE DE TESTE',company:'EMPRESA DE TESTE',event:'Treinamento de exemplo',date:'2026-10-29',location:'Local do evento',certificate_hours:'08',certificate_title:'',certificate_location:''};
const sampleConfig={x:15,y:30,width:70,height:40,font_size:16,font:'Helvetica',align:'center',color:'#252525',body:defaultCertificateBody};
function numberField(label,name,value,min,max,step='0.1'){return `<label>${label}<input type="number" name="${name}" value="${esc(value)}" min="${min}" max="${max}" step="${step}" required></label>`;}
function modelForm(template){
  const config=template?{...sampleConfig,...JSON.parse(template.config_json)}:sampleConfig;
  return field('Nome do modelo','name','text',template?.name)+`<label>${template?'Trocar fundo (opcional)':'Arquivo de fundo'} - PDF de 1 página, PNG ou JPG; até 500 KB<input type="file" name="asset" accept="application/pdf,image/png,image/jpeg" ${template?'':'required'}></label><p>Use a arte sem nome de participante e sem o texto que será preenchido abaixo. Para arquivos Word, salve uma cópia como PDF. O modelo Word enviado no chat já foi adaptado e está disponível na biblioteca.</p><label>Texto automático<textarea name="body" rows="7" maxlength="2000" required>${esc(config.body)}</textarea></label><p>Campos disponíveis: ${certificateTokens.map(name=>'<code>{{'+name+'}}</code>').join(' · ')}. Inclua sempre <code>{{nome}}</code>.</p><h3>Área de preenchimento</h3><p>Medidas em porcentagem da página. O topo e a esquerda começam em zero. Ajuste e abra a prévia antes de usar.</p><div class="certificate-controls">${numberField('Distância da esquerda (%)','x',config.x,0,90)}${numberField('Distância do topo (%)','y',config.y,0,95)}${numberField('Largura da área (%)','width',config.width,10,100)}${numberField('Altura da área (%)','height',config.height,5,100)}${numberField('Tamanho da fonte','font_size',config.font_size,8,40,'0.5')}<label>Cor do texto<input type="color" name="color" value="${esc(config.color)}"></label><label>Alinhamento<select name="align">${[['center','Centralizado'],['left','À esquerda'],['right','À direita']].map(([value,label])=>`<option value="${value}" ${config.align===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Fonte<select name="font"><option value="Helvetica" ${config.font==='Helvetica'?'selected':''}>Sem serifa</option><option value="TimesRoman" ${config.font==='TimesRoman'?'selected':''}>Com serifa</option></select></label></div>`;
}
function pdfResponse(bytes,filename,attachment=false){return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${attachment?'attachment':'inline'}; filename="${filename}"`}});}
export async function handleCertificateRoutes({request,path,url,env,data}){
  const query=(sql,...params)=>env.DB.prepare(sql).bind(...params);
  const modelMatch=path.match(/^\/admin\/certificados\/modelos\/([A-Za-z0-9_-]+)(?:\/(previa\.pdf|fundo))?$/);
  if(path==='/admin/certificados'||modelMatch){
    let template=modelMatch?await query('SELECT * FROM certificate_templates WHERE id=?',modelMatch[1]).first():null;
    if(modelMatch&&!template)return new Response('Modelo não encontrado',{status:404});
    if(modelMatch?.[2]==='fundo')return new Response(fromBase64(template.asset_base64),{headers:{'Content-Type':template.content_type,'Content-Disposition':'attachment; filename="modelo-certificado.'+(template.content_type==='application/pdf'?'pdf':template.content_type==='image/png'?'png':'jpg')+'"'}});
    if(modelMatch?.[2]==='previa.pdf'){
      try{return pdfResponse(await renderCertificate(template,samplePerson,{preview:true}),'previa-certificado.pdf');}catch(error){return notice('Revise o modelo',esc(error.message),422);}
    }
    if(data){
      try{
        const name=String(data.get('name')||'').trim();
        if(name.length<2||name.length>120)throw new Error('Informe um nome de modelo entre 2 e 120 caracteres.');
        const config=certificateConfig(data),file=data.get('asset');
        let asset=template;
        if(file&&typeof file!=='string'&&file.size)asset=await certificateAsset(new Uint8Array(await file.arrayBuffer()));
        if(!asset)throw new Error('Selecione o fundo do certificado.');
        const test={...asset,config_json:JSON.stringify(config)};
        await renderCertificate(test,samplePerson,{preview:true});
        if(template){
          await query('UPDATE certificate_templates SET name=?,content_type=?,asset_base64=?,width=?,height=?,config_json=?,revision=revision+1 WHERE id=?',name,asset.content_type,asset.asset_base64,asset.width,asset.height,JSON.stringify(config),template.id).run();
        }else{
          const id=crypto.randomUUID();
          await query('INSERT INTO certificate_templates(id,name,content_type,asset_base64,width,height,config_json) VALUES (?,?,?,?,?,?,?)',id,name,asset.content_type,asset.asset_base64,asset.width,asset.height,JSON.stringify(config)).run();
          template={id};
        }
        return redirect('/admin/certificados/modelos/'+template.id+'?salvo=1');
      }catch(error){return notice('Confira o modelo',esc(error.message)+' <a href="'+esc(path)+'">Voltar e ajustar</a>',400);}
    }
    if(template)return page(card(`${url.searchParams.has('salvo')?'<p class="notice">Modelo salvo. Confira a prévia e selecione-o no evento.</p>':''}<p class="eyebrow">MODELO DE CERTIFICADO · VERSÃO ${template.revision}</p><h1>${esc(template.name)}</h1><p><a href="${path}/previa.pdf" target="_blank" rel="noopener">Abrir prévia em PDF</a> · <a href="${path}/fundo">Baixar fundo</a></p><p>As alterações valem para próximas emissões dos eventos que usam este modelo. Certificados já emitidos mantêm seu PDF e seu link.</p>${form(path,modelForm(template)+button('Salvar nova versão'),true)}<p><a href="/admin/certificados">Voltar à biblioteca</a></p>`));
    const models=(await query('SELECT id,name,revision,created_at FROM certificate_templates ORDER BY created_at DESC').all()).results;
    const events=(await query('SELECT id,name,certificate_enabled,certificate_template_id FROM events ORDER BY id DESC').all()).results;
    return page(`<p class="eyebrow">GESTÃO DE EVENTOS</p><h1>Certificados</h1><p>Escolha a arte, ajuste o texto e ative a emissão em cada evento. Somente presenças confirmadas liberam o certificado no link individual.</p>${card('<h2>Configurar por evento</h2>'+events.map(event=>`<div class="eventrow"><div><strong>${esc(event.name)}</strong><p>${event.certificate_enabled?'Emissão automática ativada':'Emissão desativada'}</p></div><a href="/admin/certificados/eventos/${event.id}">Configurar certificado</a><a class="action-link" href="/admin/certificados/eventos/${event.id}/imprimir">Baixar todos para imprimir ↓</a></div>`).join(''))}${card('<h2>Biblioteca de modelos</h2>'+models.map(model=>`<div class="eventrow"><div><strong>${esc(model.name)}</strong><p>Versão ${model.revision}</p></div><a href="/admin/certificados/modelos/${model.id}">Ajustar / trocar layout</a><a href="/admin/certificados/modelos/${model.id}/previa.pdf" target="_blank" rel="noopener">Prévia PDF</a></div>`).join(''))}${card('<h2>Adicionar outro layout</h2>'+form('/admin/certificados',modelForm(null)+button('Adicionar modelo'),true))}<p><a href="/admin">Voltar ao painel</a></p>`);
  }
  const eventMatch=path.match(/^\/admin\/certificados\/eventos\/(\d+)(?:\/(previa\.pdf|imprimir\.pdf|imprimir|manifest\.json))?$/);
  if(eventMatch){
    const event=await query('SELECT * FROM events WHERE id=?',eventMatch[1]).first();
    if(!event)return new Response('Evento não encontrado',{status:404});
    if(eventMatch[2]==='imprimir.pdf')return redirect('/admin/certificados/eventos/'+event.id+'/imprimir');
    if(eventMatch[2]==='manifest.json'){
      try{return Response.json(await certificatePrintManifest(env,event));}
      catch(error){return Response.json({error:error.message},{status:409});}
    }
    if(eventMatch[2]==='imprimir')return page(card(`<h1>Imprimir certificados</h1><h2>${esc(event.name)}</h2><p>Vamos reunir os certificados dos presentes em um único PDF, em ordem alfabética. Mantenha esta página aberta até terminar.</p><div id="certificate-print" data-manifest="/admin/certificados/eventos/${event.id}/manifest.json"><p role="status" aria-live="polite">Preparando certificados…</p><a class="action-link" download hidden>Baixar PDF com todos os certificados ↓</a><p><button type="button">Preparar novamente</button></p></div><p>Na impressão, selecione papel A4, orientação paisagem e uma página por folha. Confira a prévia antes de imprimir.</p><a href="/admin/certificados/eventos/${event.id}">Voltar ao evento</a><script type="module" src="/assets/certificate-print-client.mjs"></script>`));
    const models=(await query('SELECT id,name,revision FROM certificate_templates ORDER BY name').all()).results;
    if(eventMatch[2]){
      const model=event.certificate_template_id?await query('SELECT * FROM certificate_templates WHERE id=?',event.certificate_template_id).first():null;
      if(!model)return notice('Escolha um modelo','Salve o modelo deste evento antes de abrir a prévia.',400);
      try{return pdfResponse(await renderCertificate(model,{...samplePerson,...event,event:event.name,company:samplePerson.company,name:samplePerson.name,certificate_hours:event.certificate_hours||'[definir carga horária]'},{preview:true}),'previa-certificado-evento.pdf');}catch(error){return notice('Revise o certificado',esc(error.message),422);}
    }
    if(data){
      const modelId=String(data.get('template_id')||''),enabled=data.get('enabled')==='yes'?1:0,hours=String(data.get('hours')||'').trim(),title=String(data.get('title')||'').trim(),location=String(data.get('location')||'').trim();
      const model=modelId?await query('SELECT * FROM certificate_templates WHERE id=?',modelId).first():null;
      if((modelId&&!model)||(enabled&&!model)||title.length>120||location.length>120)return notice('Confira a configuração','Selecione um modelo válido e use até 120 caracteres nos campos de treinamento e local.',400);
      if(hours&&(!/^\d{1,4}([.,]\d{1,2})?$/.test(hours)||Number(hours.replace(',','.'))<=0||Number(hours.replace(',','.'))>9999))return notice('Confira a carga horária','Informe a duração real do treinamento em horas, como 8 ou 1,5.',400);
      if(enabled&&/{{\s*carga_horaria\s*}}/.test(JSON.parse(model.config_json).body)&&!hours)return notice('Informe a carga horária','O modelo usa a carga horária. Informe a duração real antes de ativar a emissão.',400);
      await query('UPDATE events SET certificate_template_id=?,certificate_enabled=?,certificate_hours=?,certificate_title=?,certificate_location=? WHERE id=?',modelId||null,enabled,hours,title,location,event.id).run();
      return redirect(path+'?salvo=1');
    }
    return page(card(`${url.searchParams.has('salvo')?'<p class="notice">Configuração salva.</p>':''}<p class="eyebrow">CERTIFICADOS DO EVENTO</p><h1>${esc(event.name)}</h1><p>A presença confirmada libera o PDF automaticamente quando esta configuração estiver ativada. Quem já está presente também poderá baixar. Inscrição antecipada sozinha não libera certificado.</p>${form(path,`<label>Modelo<select name="template_id"><option value="">Selecione</option>${models.map(model=>`<option value="${model.id}" ${event.certificate_template_id===model.id?'selected':''}>${esc(model.name)} · versão ${model.revision}</option>`).join('')}</select></label>`+field('Carga horária real do treinamento (horas)','hours','text',event.certificate_hours,false)+field('Nome no certificado (vazio = nome do evento)','title','text',event.certificate_title,false)+field('Local no certificado (vazio = local do evento)','location','text',event.certificate_location,false)+`<label class="check"><input type="checkbox" name="enabled" value="yes" ${event.certificate_enabled?'checked':''}>Ativar certificado após confirmação de presença</label>`+button('Salvar configuração'))}${event.certificate_template_id?`<p><a href="${path}/previa.pdf" target="_blank" rel="noopener">Abrir prévia deste evento em PDF</a></p>`:''}<p class="export-actions"><a class="action-link certificate-download" href="${path}/imprimir">Baixar todos os certificados para imprimir ↓</a></p><p>O arquivo reúne somente os presentes, em ordem de nome, com uma página por certificado. Inscritos sem presença não entram. Certificados já emitidos mantêm seu layout; os que faltarem serão gerados conforme a configuração atual.</p><p>Salve e confira a prévia antes de divulgar. Trocar o modelo mantém os links de entrega. PDFs já emitidos não são substituídos.</p><p><a href="/admin/certificados">Biblioteca de modelos</a> · <a href="/admin">Voltar ao painel</a></p>`));
  }
  if(path.startsWith('/certificados/')){
    const match=path.match(/^\/certificados\/([a-f0-9]{64})(?:\/(baixar\.pdf))?$/);
    if(!match)return new Response('Não encontrado',{status:404});
    if(request.method!=='GET')return new Response('Método inválido',{status:405});
    const token=match[1];
    const person=await query('SELECT r.*,e.name AS event,e.date,e.start_time,e.end_time,e.location,e.certificate_enabled,e.certificate_template_id FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.token=?',token).first();
    if(!person)return new Response('Não encontrado',{status:404});
    const cached=await query('SELECT issued_at,pdf_base64,code FROM certificates WHERE registration_id=?',person.id).first();
    if(person.waitlisted)return notice('Lista de espera','Sua vaga ainda não foi liberada. Aguarde a organização antes do check-in e da emissão do certificado.',match[2]?403:200);
    if(match[2]){
      if(!person.checked_in_at)return notice('Presença ainda não confirmada','Leia o QR permanente no local e confirme sua presença com o telefone usado na inscrição. A inscrição sozinha não libera o certificado.',403);
      try{
        const certificate=await ensureCertificate(env,token);
        if(!certificate?.pdf_base64)return notice('Certificado em preparação','A organização ainda precisa configurar ou ativar o certificado deste evento.',409);
        return pdfResponse(fromBase64(certificate.pdf_base64),'certificado-somaforce.pdf',true);
      }catch(error){return notice('Não foi possível emitir o certificado',esc(error.message)+' Procure a organização ou tente novamente.',422);}
    }
    const available=person.checked_in_at&&(cached?.pdf_base64||(person.certificate_enabled&&person.certificate_template_id));
    return page(card(`${person.checked_in_at?`<div class="presence-confirmation" role="status"><span class="success-mark" aria-hidden="true">✓</span><p class="eyebrow">PRESENÇA CONFIRMADA ✓</p><h1>Presença confirmada!</h1><h2>${esc(person.name)}</h2><p><strong>${esc(person.event)}</strong></p>${eventDetails(person)}<p>Seu check-in foi registrado. Não é necessário confirmar novamente.</p></div>`:`<p class="eyebrow">INSCRIÇÃO REGISTRADA</p><h1>${esc(person.name)}</h1><h2>${esc(person.event)}</h2>${eventDetails(person)}`}${available?`<p>Seu certificado individual está disponível neste mesmo endereço.</p><p><a class="action-link certificate-download" href="/certificados/${token}/baixar.pdf">Baixar meu certificado em PDF ↓</a></p>${cached?.issued_at?'<p>Emitido em '+esc(cached.issued_at)+' UTC.</p>':''}`:person.checked_in_at?'<p>Presença confirmada. A organização está preparando o certificado. Volte a este mesmo link para baixar.</p>':'<p>A inscrição não confirma presença. Leia o QR permanente no local no dia do evento e confirme sua presença com o telefone da inscrição para liberar o certificado quando ele estiver configurado.</p>'}<p>Guarde este link pessoal. Ele continuará sendo seu local de entrega.</p>${cached?.code?`<p><a href="/validar-certificado?codigo=${cached.code}">Consultar registro de emissão</a></p>`:''}<a href="/entrada/${token}">Ver minha inscrição</a><p class="export-actions"><a class="action-link" href="/eventos">Próximos eventos →</a></p>`));
  }
  return null;
}
