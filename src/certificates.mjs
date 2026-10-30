import {identity} from './identity.mjs';
import {PDFDocument,StandardFonts,rgb} from './pdf-lib-vendor.mjs';
import {drawCertificateText,restyleIssuedCertificate} from './certificate-text.mjs';

export const defaultCertificateBody='{{nome}} participou do treinamento {{evento}}, realizado em {{local}}, no dia {{data}}, com carga horária de {{carga_horaria}} horas.';
export const certificateTokens=['nome','empresa','evento','local','data','carga_horaria'];
export const fromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export function toBase64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.slice(offset,offset+8192));return btoa(binary);}
export function certificateConfig(data){
  const config={body:String(data.get('body')||'').trim(),align:String(data.get('align')||'center'),color:String(data.get('color')||'#252525'),font:String(data.get('font')||'Helvetica')};
  for(const key of ['x','y','width','height','font_size'])config[key]=Number(data.get(key));
  if(!/{{\s*nome\s*}}/.test(config.body)||config.body.length>2000)throw new Error('O texto deve conter {{nome}} e ter até 2.000 caracteres.');
  const unknown=Array.from(config.body.matchAll(/{{\s*([^{}]+)\s*}}/g)).map(match=>match[1].trim()).filter(name=>!certificateTokens.includes(name));
  if(unknown.length)throw new Error('Campo desconhecido: '+unknown.join(', '));
  if(!['left','center','right'].includes(config.align)||!['Helvetica','TimesRoman'].includes(config.font)||!/^#[a-fA-F0-9]{6}$/.test(config.color))throw new Error('Confira alinhamento, fonte e cor.');
  if(!Object.values(config).filter(value=>typeof value==='number').every(Number.isFinite)||config.x<0||config.y<0||config.width<10||config.height<5||config.x+config.width>100||config.y+config.height>100||config.font_size<8||config.font_size>40)throw new Error('A área de texto deve caber na página, com posições em porcentagem e fonte de 8 a 40.');
  return config;
}
export async function certificateAsset(bytes){
  if(!bytes.length||bytes.length>500000)throw new Error('Envie um modelo de até 500 KB.');
  let type,width,height;
  const pdf=String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(pdf){
    let source;try{source=await PDFDocument.load(bytes);}catch{throw new Error('Não foi possível abrir o PDF. Use um arquivo sem senha.');}
    if(source.getPageCount()!==1)throw new Error('O modelo deve ter uma única página.');
    const page=source.getPage(0);
    if(page.getRotation().angle%360!==0)throw new Error('Exporte o PDF com a página na orientação final, sem rotação.');
    ({width,height}=page.getSize());type='application/pdf';
  }else if(png||jpeg){
    const document=await PDFDocument.create();
    let image;try{image=png?await document.embedPng(bytes):await document.embedJpg(bytes);}catch{throw new Error('Imagem inválida. Use PNG ou JPG.');}
    [width,height]=image.width>=image.height?[841.89,595.28]:[595.28,841.89];type=png?'image/png':'image/jpeg';
  }else throw new Error('Use um fundo em PDF, PNG ou JPG. Para Word, exporte como PDF primeiro.');
  if(width<100||height<100||width>2000||height>2000)throw new Error('Use uma página de tamanho usual, como A4.');
  return {content_type:type,asset_base64:toBase64(bytes),width,height};
}
function linesFor(text,font,size,width){
  const lines=[];
  for(const paragraph of text.split('\n')){
    if(!paragraph.trim()){lines.push('');continue;}
    let line='';
    for(const word of paragraph.trim().split(/\s+/)){
      const candidate=line?line+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
      if(line){lines.push(line);line='';}
      for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}
    }
    if(line)lines.push(line);
  }
  return lines;
}
export async function renderCertificate(template,person,{preview=false,code='',now=new Date()}={}){
  const document=await PDFDocument.create(),config=JSON.parse(template.config_json);
  const width=Number(template.width),height=Number(template.height);
  const page=document.addPage([width,height]),bytes=fromBase64(template.asset_base64);
  if(template.content_type==='application/pdf'){
    const source=await PDFDocument.load(bytes),sourcePage=source.getPage(0);
    if(sourcePage.node.Contents()){
      const background=await document.embedPage(sourcePage);page.drawPage(background,{x:0,y:0,width,height});
    }
  }else{
    const image=template.content_type==='image/png'?await document.embedPng(bytes):await document.embedJpg(bytes);
    const ratio=Math.min(width/image.width,height/image.height),imageWidth=image.width*ratio,imageHeight=image.height*ratio;
    page.drawImage(image,{x:(width-imageWidth)/2,y:(height-imageHeight)/2,width:imageWidth,height:imageHeight});
  }
  const date=new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(person.date+'T12:00:00Z'));
  const values={nome:person.name,empresa:person.company,evento:person.certificate_title||person.event,local:person.certificate_location||person.location,data:date,carga_horaria:person.certificate_hours};
  const font=await drawCertificateText(document,page,config,values);
  const label=preview?'PRÉVIA DE TESTE - SEM VALIDADE':code?'Código de emissão: '+code:'';
  if(label)page.drawText(label,{x:15,y:4,size:preview?9:6,font,color:preview?rgb(0.8,0.1,0.15):rgb(0.35,0.35,0.35)});
  document.setTitle(preview?'Prévia de certificado - Gestão de Eventos':'Certificado - '+person.name);
  document.setAuthor(identity().name);document.setCreationDate(now);
  return document.save();
}
export async function ensureCertificate(env,token){
  try{return await ensureCertificateCore(env,token);}catch(error){
    const message=String(error.message||'Falha na emissão').slice(0,500);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO certificates(registration_id,last_error,attempted_at) SELECT id,?,CURRENT_TIMESTAMP FROM registrations WHERE token=? AND checked_in_at IS NOT NULL ON CONFLICT(registration_id) DO UPDATE SET last_error=excluded.last_error,attempted_at=excluded.attempted_at WHERE certificates.pdf_base64 IS NULL").bind(message,token),
      env.DB.prepare("INSERT INTO audit_log(event_id,participant_token,action,label,details_json) SELECT event_id,token,'certificate_failed',name,json_object('reason',?) FROM registrations WHERE token=? AND checked_in_at IS NOT NULL").bind(message,token)
    ]);
    throw error;
  }
}
async function ensureCertificateCore(env,token){
  const person=await env.DB.prepare('SELECT r.*,e.name AS event,e.date,e.location,e.certificate_template_id,e.certificate_enabled,e.certificate_hours,e.certificate_title,e.certificate_location FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.token=?').bind(token).first();
  if(!person?.checked_in_at||person.waitlisted)return null;
  const cached=await env.DB.prepare('SELECT * FROM certificates WHERE registration_id=?').bind(person.id).first();
  if(cached?.pdf_base64){
    const revised=await restyleIssuedCertificate(fromBase64(cached.pdf_base64),person.name);
    if(!revised)return cached;
    const encoded=toBase64(revised);
    if(encoded.length>950000)throw new Error('O certificado formatado ficou muito grande. Procure a organização.');
    await env.DB.prepare('UPDATE certificates SET pdf_base64=? WHERE registration_id=? AND pdf_base64=? AND EXISTS(SELECT 1 FROM registrations WHERE id=? AND checked_in_at IS NOT NULL AND revision=?)').bind(encoded,person.id,cached.pdf_base64,person.id,person.revision).run();
    return env.DB.prepare('SELECT * FROM certificates WHERE registration_id=?').bind(person.id).first();
  }
  if(!person.certificate_enabled||!person.certificate_template_id)return null;
  const template=await env.DB.prepare('SELECT * FROM certificate_templates WHERE id=?').bind(person.certificate_template_id).first();
  if(!template)return null;
  const config=JSON.parse(template.config_json);
  if(/{{\s*carga_horaria\s*}}/.test(config.body)&&!person.certificate_hours)throw new Error('A organização precisa informar a carga horária do evento.');
  const code=crypto.randomUUID().replaceAll('-','');
  const pdf=await renderCertificate(template,person,{code});
  const encoded=toBase64(pdf);
  if(encoded.length>950000)throw new Error('O certificado ficou muito grande. Use um modelo de fundo menor.');
  await env.DB.prepare('INSERT INTO certificates(registration_id,template_version,issued_at,pdf_base64,code,last_error,attempted_at) SELECT ?,?,CURRENT_TIMESTAMP,?,?,NULL,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=? AND r.token=? AND r.revision=? AND r.checked_in_at IS NOT NULL AND r.waitlisted=0 AND e.certificate_enabled=1 AND e.certificate_template_id=?) AND EXISTS(SELECT 1 FROM certificate_templates WHERE id=? AND revision=?) ON CONFLICT(registration_id) DO UPDATE SET template_version=excluded.template_version,issued_at=excluded.issued_at,pdf_base64=excluded.pdf_base64,code=excluded.code,last_error=NULL,attempted_at=CURRENT_TIMESTAMP WHERE certificates.pdf_base64 IS NULL').bind(person.id,template.id+':'+template.revision,encoded,code,person.id,token,person.revision,template.id,template.id,template.revision).run();
  return env.DB.prepare('SELECT * FROM certificates WHERE registration_id=?').bind(person.id).first();
}

export async function certificatePrintManifest(env,event){
  const result=await env.DB.prepare('SELECT r.token,r.name,r.company,c.pdf_base64 IS NOT NULL AS ready FROM registrations r LEFT JOIN certificates c ON c.registration_id=r.id WHERE r.event_id=? AND r.checked_in_at IS NOT NULL').bind(event.id).all();
  const people=result.results;
  if(!people.length)throw new Error('Este evento ainda não tem presenças confirmadas.');
  const collator=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
  people.sort((first,second)=>collator.compare(first.name,second.name)||collator.compare(first.company,second.company)||first.token.localeCompare(second.token));
  if(people.some(person=>!person.ready)&&(!event.certificate_enabled||!event.certificate_template_id))throw new Error('Ative e configure o certificado do evento para gerar os que faltam.');
  return {eventName:event.name,filename:'certificados-evento-'+event.id+'.pdf',people:people.map(person=>({name:person.name,url:'/certificados/'+person.token+'/baixar.pdf'}))};
}
