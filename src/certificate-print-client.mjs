import {PDFDocument} from './pdf-lib-vendor.mjs';

export async function assembleCertificateBook(manifest,loadPdf,onProgress=()=>{}){
  if(!manifest.people?.length)throw new Error('Nenhuma presença confirmada neste evento.');
  const combined=await PDFDocument.create();
  combined.setTitle('Certificados para impressão - '+manifest.eventName);
  combined.setAuthor('Gestão de Eventos');
  for(let index=0;index<manifest.people.length;index++){
    const person=manifest.people[index];
    onProgress(index,manifest.people.length,person.name);
    try{
      const source=await PDFDocument.load(await loadPdf(person.url));
      const pages=await combined.copyPages(source,source.getPageIndices());
      for(const page of pages)combined.addPage(page);
    }catch(error){throw new Error('Não foi possível preparar o certificado de '+person.name+'. '+error.message);}
  }
  return combined.save();
}

if(typeof document!=='undefined'){
  const root=document.getElementById('certificate-print');
  if(root){
    const status=root.querySelector('[role=status]'),retry=root.querySelector('button'),download=root.querySelector('[download]');
    let objectUrl;
    async function run(){
      retry.disabled=true;download.hidden=true;status.textContent='Buscando presenças confirmadas…';
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      try{
        const response=await fetch(root.dataset.manifest,{credentials:'same-origin',redirect:'error'});
        const manifest=await response.json();
        if(!response.ok)throw new Error(manifest.error||'Não foi possível consultar o evento.');
        const bytes=await assembleCertificateBook(manifest,async url=>{
          const pdf=await fetch(url,{credentials:'same-origin',redirect:'error'});
          if(!pdf.ok||!pdf.headers.get('Content-Type')?.startsWith('application/pdf'))throw new Error('Confira o modelo e a configuração do evento e tente novamente.');
          return new Uint8Array(await pdf.arrayBuffer());
        },(index,total,name)=>{status.textContent='Preparando '+(index+1)+' de '+total+': '+name;});
        objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
        download.href=objectUrl;download.download=manifest.filename;download.hidden=false;
        status.textContent='Pronto! '+manifest.people.length+' certificados reunidos em um único PDF.';
        download.click();
      }catch(error){status.textContent=error.message;}
      finally{retry.disabled=false;}
    }
    retry.addEventListener('click',run);
    run();
  }
}
