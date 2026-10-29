import { constants, existsSync } from 'node:fs';
import { mkdir, open, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defaultWorkspace, readSession } from '../server/session.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// A fresh clone needs its dependencies and one frontend build before the first launch.
if(!existsSync(join(root,'node_modules/@qvac/sdk')))throw new Error('Dependencies are missing. Run `npm ci` in the QVAC UI folder first.');
if(!existsSync(join(root,'dist/index.html'))){console.log('Building the interface (first launch)…');const build=spawnSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build'],{cwd:root,stdio:'inherit'});if(build.status!==0)throw new Error('The interface build failed; run `npm run build` to see why.');}
await mkdir(defaultWorkspace(),{recursive:true,mode:0o700});
const directory=await realpath(defaultWorkspace());
let session=await readSession(directory),started=false;
if(!session){
  const logfile=await open(join(directory,'server.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW||0),0o600);
  try{
    const info=await logfile.stat();
    if(!info.isFile()||(process.getuid&&info.uid!==process.getuid()))throw new Error('Unsafe server log ownership');
    await logfile.chmod(0o600);
    const child=spawn(process.execPath,[join(root,'server/index.mjs')],{cwd:root,detached:true,stdio:['ignore',logfile.fd,logfile.fd],env:{...process.env,QVAC_UI_DATA:directory}});
    await new Promise((resolveSpawn,reject)=>{child.once('spawn',resolveSpawn);child.once('error',reject);});child.unref();started=true;
  }finally{await logfile.close();}
  const deadline=Date.now()+25000;
  while(!session&&Date.now()<deadline){await new Promise(r=>setTimeout(r,250));session=await readSession(directory);}
  if(!session)throw new Error('QVAC UI did not become ready. Check the private .local/server.log file or close a conflicting server and retry.');
}
if(process.argv.includes('--print-url'))console.log(session.url);
else console.log(`QVAC UI ${started?'started':'is already running'} locally at ${session.origin}.`);
if(!process.argv.includes('--no-open')){
  const command=process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'rundll32':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',session.url]:[session.url];
  const opener=spawn(command,args,{stdio:'ignore',detached:true});
  await new Promise((resolveOpen,reject)=>{opener.once('spawn',resolveOpen);opener.once('error',reject);});opener.unref();
}
