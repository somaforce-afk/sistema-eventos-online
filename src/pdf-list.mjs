import {identity} from './identity.mjs';
import {PDFDocument,StandardFonts,rgb} from './pdf-lib-vendor.mjs';

const red=rgb(0.788,0.122,0.176),ink=rgb(0.15,0.15,0.15),muted=rgb(0.42,0.37,0.38);
const collator=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
const columns=[{key:'company',label:'Empresa',x:40,width:185},{key:'name',label:'Nome',x:225,width:195},{key:'phone',label:'Telefone',x:420,width:135.28}];
function printable(value,font){
  return Array.from(String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ')).map(char=>{try{font.encodeText(char);return char;}catch{return '\\u{'+char.codePointAt(0).toString(16).toUpperCase()+'}';}}).join('');
}
function wrap(value,font,size,width){
  const text=printable(value,font).replace(/\s+/g,' ').trim();
  if(!text)return [''];
  const lines=[];
  let line='';
  for(const word of text.split(' ')){
    const candidate=line?line+' '+word:word;
    if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
    if(line){lines.push(line);line='';}
    for(const char of word){
      if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}
      line+=char;
    }
  }
  if(line)lines.push(line);
  return lines;
}
function phone(value){const digits=String(value??'');return digits.length===11?`(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`:digits.length===10?`(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`:digits;}

export async function createParticipantPdf({rows,eventName='Todos os eventos',status='',logoBase64,now=new Date()}){
  const document=await PDFDocument.create();
  document.setTitle(identity().name+' - Lista de participantes');
  document.setAuthor(identity().name);
  document.setCreator(identity().name);
  document.setCreationDate(now);
  const regular=await document.embedFont(StandardFonts.Helvetica),bold=await document.embedFont(StandardFonts.HelveticaBold);
  const logo=await document.embedPng(Uint8Array.from(atob(logoBase64),char=>char.charCodeAt(0)));
  const generated=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(now);
  const statusLabel=({'':'Todos os participantes',inscrito:'Inscritos aguardando',presente:'Presentes',ausente:'Ausentes em eventos encerrados'})[status]||'Todos os participantes';
  const groups=new Map();
  for(const row of rows){const key=row.event_id;if(!groups.has(key))groups.set(key,{name:row.event,rows:[]});groups.get(key).rows.push(row);}
  const ordered=Array.from(groups.values()).sort((first,second)=>collator.compare(first.name,second.name));
  if(!ordered.length)ordered.push({name:eventName,rows:[]});
  let page,cursor;
  function startPage(group){
    page=document.addPage([595.28,841.89]);
    if(identity().logoBase64)page.drawImage(logo,{x:40,y:754,width:Math.min(210,75*logo.width/logo.height),height:Math.min(75,210*logo.height/logo.width)});
    else {const name=printable(identity().name,bold);let size=15;while(size>6&&bold.widthOfTextAtSize(name,size)>260)size-=.5;page.drawText(name,{x:40,y:785,size,font:bold,color:ink});}
    page.drawText(printable(identity().subtitle,bold),{x:104,y:742,size:9,font:bold,color:red});
    page.drawText('Gerado em '+generated,{x:347,y:789,size:8,font:regular,color:muted});
    page.drawText('Horário de Brasília',{x:347,y:777,size:8,font:regular,color:muted});
    page.drawLine({start:{x:40,y:725},end:{x:555.28,y:725},thickness:2,color:red});
    page.drawText('Lista de participantes',{x:40,y:695,size:20,font:bold,color:ink});
    cursor=669;
    for(const line of wrap(group.name,bold,12,515.28)){page.drawText(line,{x:40,y:cursor,size:12,font:bold,color:ink});cursor-=16;}
    page.drawText(printable(statusLabel,regular),{x:40,y:cursor-5,size:9,font:regular,color:muted});
    page.drawText(`${group.rows.length} participantes neste evento | ${rows.length} no relatório`,{x:40,y:cursor-20,size:9,font:regular,color:muted});
    cursor-=61;
    page.drawRectangle({x:40,y:cursor,width:515.28,height:26,color:red});
    for(const column of columns)page.drawText(column.label,{x:column.x+8,y:cursor+9,size:10,font:bold,color:rgb(1,1,1)});
  }
  for(const group of ordered){
    startPage(group);
    group.rows.sort((first,second)=>collator.compare(first.company,second.company)||collator.compare(first.name,second.name)||collator.compare(first.phone,second.phone));
    if(!group.rows.length)page.drawText('Nenhum participante para os filtros selecionados.',{x:48,y:cursor-23,size:10,font:regular,color:muted});
    for(const [index,row]of group.rows.entries()){
      const cells=columns.map(column=>wrap(column.key==='phone'?phone(row.phone):row[column.key],regular,9,column.width-16));
      const height=Math.max(1,...cells.map(lines=>lines.length))*12+16;
      if(cursor-height<65)startPage(group);
      if(index%2===0)page.drawRectangle({x:40,y:cursor-height,width:515.28,height,color:rgb(0.995,0.965,0.97)});
      for(const [cellIndex,lines]of cells.entries())for(const [lineIndex,line]of lines.entries())page.drawText(line,{x:columns[cellIndex].x+8,y:cursor-17-lineIndex*12,size:9,font:regular,color:ink});
      page.drawLine({start:{x:40,y:cursor-height},end:{x:555.28,y:cursor-height},thickness:0.5,color:rgb(0.91,0.86,0.87)});
      cursor-=height;
    }
  }
  const pages=document.getPages();
  for(const [index,current]of pages.entries()){
    current.drawLine({start:{x:40,y:48},end:{x:555.28,y:48},thickness:0.5,color:rgb(0.91,0.86,0.87)});
    current.drawText(printable(identity().name+' | Lista da organização',regular),{x:40,y:33,size:8,font:regular,color:muted});
    current.drawText(`Página ${index+1} de ${pages.length}`,{x:465,y:33,size:8,font:regular,color:muted});
  }
  return document.save();
}
