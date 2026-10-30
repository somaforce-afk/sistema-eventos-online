import application from './worker.mjs';
import {identity,readIdentity,withIdentity} from './identity.mjs';
import {assets} from './static-assets.mjs';
import qrcode from './qrcode.mjs';

const encoder=new TextEncoder();
async function initializeAccess(db,password){
  const existing=await db.prepare("SELECT value FROM settings WHERE key='admin_password'").first();
  if(existing)return true;
  if(typeof password!=='string'||password.length<12||password.length>128)return false;
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
  const hashed=Array.from(bits,n=>n.toString(16).padStart(2,'0')).join('');
  await db.prepare("INSERT INTO settings(key,value) VALUES('admin_password',?) ON CONFLICT(key) DO NOTHING").bind(salt+':'+hashed).run();return true;
}
function unavailable(message){return new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparando sua instalação</title><main style="max-width:640px;margin:60px auto;padding:24px;font:18px/1.6 Arial"><h1>Preparando sua instalação</h1><p>'+message+'</p><p>Volte após concluir a publicação na sua conta Cloudflare.</p></main></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});}
export default {async fetch(request,env,ctx){
  try{
    if(!env.DB)return unavailable('O banco da sua instalação ainda não foi vinculado.');
    const initialized=await initializeAccess(env.DB,env.INITIAL_ADMIN_PASSWORD);
    if(!initialized)return unavailable('Configure INITIAL_ADMIN_PASSWORD como segredo da sua aplicação, usando uma senha de 12 a 128 caracteres.');
    const brand=await readIdentity(env.DB);
    return withIdentity(brand,async()=>{
      const configured={...env,...assets,SETUP_KEY:'',BRAND_NAME:brand.name,PRINT_CLIENT_JS:assets.PRINT_CLIENT_JS.replace("combined.setAuthor('Gestão de Eventos');",'combined.setAuthor('+JSON.stringify(brand.name)+');'),LOGO_BASE64:brand.logoBase64||assets.LOGO_BASE64,CSS:assets.CSS.replaceAll('#c91f2d',brand.color)+'\n.brand-official img{max-height:90px;object-fit:contain}.brand-official small{margin-left:0}.identity-preview{max-width:260px}\n'};
      if(new URL(request.url).pathname==='/qr.svg'){const qr=qrcode(0,'M');qr.addData(new URL(request.url).origin+'/');qr.make();configured.QR_SVG=qr.createSvgTag({cellSize:5,margin:20,scalable:true});}
      return application.fetch(request,configured,ctx);
    });
  }catch{return unavailable('A publicação ou as migrações do banco ainda não foram concluídas. Confira o resultado da instalação na Cloudflare.');}
}};
