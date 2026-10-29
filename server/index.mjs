import { createApp } from './app.mjs';
import { startSession } from './session.mjs';
const app=await startSession({createApp,port:Number(process.env.PORT||4317)});
console.log(`QVAC UI ${app.owned?'running locally':'is already running; reusing the workspace'}. Open this private session URL:\n${app.url}`);
let stopping=false;
if(app.owned)for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;try{await app.close();}finally{process.exit(0);}});
