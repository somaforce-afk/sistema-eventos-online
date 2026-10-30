import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const defaultIdentity={name:'Gestão de Eventos',subtitle:'EVENTOS',color:'#c91f2d',logoBase64:'',configured:false};
export const identity=()=>context.getStore()||defaultIdentity;
export const withIdentity=(value,callback)=>context.run(value,callback);
export async function readIdentity(db){
  const row=await db.prepare("SELECT value FROM settings WHERE key='organization_identity'").first();
  if(!row)return {...defaultIdentity};
  try{const value=JSON.parse(row.value);if(typeof value.name!=='string'||!value.name.trim()||!/^#[a-f0-9]{6}$/i.test(value.color||''))return {...defaultIdentity};return {...defaultIdentity,...value,configured:true};}catch{return {...defaultIdentity};}
}
