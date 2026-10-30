import {readFileSync,writeFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const assets={CSS:read('style.css'),PDF_CLIENT_JS:read('pdf-lib-vendor.mjs'),PRINT_CLIENT_JS:read('certificate-print-client.mjs'),LOGO_BASE64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',QR_SVG:''};
writeFileSync(new URL('../src/static-assets.mjs',import.meta.url),'export const assets='+JSON.stringify(assets)+';\n');
