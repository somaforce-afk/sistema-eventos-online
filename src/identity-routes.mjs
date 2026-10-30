import {PDFDocument} from './pdf-lib-vendor.mjs';
import {identity} from './identity.mjs';
import {page,card,form,field,button,esc,redirect,notice} from './ui.mjs';
export async function handleIdentity({path,url,data,env}){
  if(path==='/admin'&&!data&&!identity().configured)return redirect('/admin/identidade?primeiro=1');
  if(path!=='/admin/identidade')return null;
  const current=identity();
  if(data){
    const name=String(data.get('name')||'').trim().normalize('NFC'),subtitle=String(data.get('subtitle')||'EVENTOS').trim(),color=String(data.get('color')||'');
    if(name.length<2||name.length>80||subtitle.length>80||!/^#[a-f0-9]{6}$/i.test(color))return notice('Confira sua marca','Informe nome de 2 a 80 caracteres e uma cor válida.',400);
    let logoBase64=current.logoBase64;
    const image=data.get('logo');
    if(image&&typeof image!=='string'&&image.size){
      if(image.size>500000)return notice('Logo muito grande','Use um PNG de até 500 KB.',400);
      const bytes=new Uint8Array(await image.arrayBuffer());
      if(bytes.length<24||Array.from(bytes.slice(0,8)).join(',')!=='137,80,78,71,13,10,26,10')return notice('Confira a logo','Use um arquivo PNG válido.',400);
      const view=new DataView(bytes.buffer);if(view.getUint32(16)>4000||view.getUint32(20)>2000)return notice('Logo muito grande','Use uma logo com até 4.000 x 2.000 pixels.',400);
      try{const pdf=await PDFDocument.create();await pdf.embedPng(bytes);}catch{return notice('Confira a logo','Não foi possível abrir o PNG. Envie uma imagem válida.',400);}
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));logoBase64=btoa(binary);
    }
    if(data.get('remove_logo')==='yes')logoBase64='';
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings(key,value) VALUES('organization_identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({name,subtitle,color,logoBase64})),
      env.DB.prepare("INSERT INTO audit_log(action,label) VALUES ('identity_updated','Marca da organização')")
    ]);
    return redirect('/admin/identidade?salvo=1');
  }
  return page(`<p class="eyebrow">SUA INSTALAÇÃO</p><h1>Minha empresa</h1><p>${url.searchParams.has('primeiro')?'Seu acesso está pronto. Personalize a empresa para começar a criar seus eventos.':'A marca da sua organização aparece nos convites, no check-in e nos documentos.'}</p>${url.searchParams.has('salvo')?'<p class="notice">Marca salva. Sua instalação já está personalizada.</p>':''}${card(form(path,field('Nome da empresa','name','text',current.configured?current.name:'')+field('Subtítulo','subtitle','text',current.subtitle,false)+field('Cor principal','color','color',current.color)+'<label>Logo em PNG (até 500 KB; até 4.000 x 2.000 pixels)<input type="file" name="logo" accept="image/png"></label>'+(current.logoBase64?'<p><img src="/logo.png" alt="Logo atual" class="identity-preview"></p><label class="check"><input type="checkbox" name="remove_logo" value="yes">Remover logo atual</label>':'<p>Sem logo, o sistema exibe o nome da empresa.</p>')+button('Salvar minha empresa'),true))}<p><a class="action-link certificate-download" href="/admin">Ir para o Dashboard →</a></p>`);
}
