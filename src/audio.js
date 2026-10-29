export function wavFile(chunks, sourceRate) {
  const count=chunks.reduce((n,c)=>n+c.length,0),samples=new Float32Array(count);let offset=0;
  for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  const rate=16000,length=Math.floor(count*rate/sourceRate),buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const str=(at,text)=>[...text].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){const p=i*sourceRate/rate,a=Math.floor(p),f=p-a,v=Math.max(-1,Math.min(1,(samples[a]||0)*(1-f)+(samples[a+1]||0)*f));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
  return new File([buffer],'voice-turn.wav',{type:'audio/wav'});
}
export async function fileUpload(file){if(!file||file.size>128*1024*1024)throw Error('Choose a file up to 128 MB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return{name:file.name,base64:btoa(binary)};}
export function audioBlob(audio){const raw=atob(audio.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return new Blob([bytes],{type:audio.mime||'audio/wav'});}

// Explicit microphone ownership. Detection only segments audio locally; recognition remains QVAC.
export async function captureTurn({automatic=false,onLevel=()=>{},onFinish,onSilence=()=>{},isCurrent=()=>true}){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone unavailable. Upload a WAV recording instead.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
  if(!isCurrent()){stream.getTracks().forEach(t=>t.stop());return null;}
  let context,source,processor,gain,timer,stopped=false;const chunks=[];let samples=0,speechMs=0,lastVoice=0,heard=false;
  const cleanup=()=>{clearTimeout(timer);if(processor){processor.onaudioprocess=null;processor.disconnect();}source?.disconnect();gain?.disconnect();stream.getTracks().forEach(t=>t.stop());context?.close().catch(()=>{});};
  const stop=(keep=true)=>{if(stopped)return;stopped=true;cleanup();if(keep&&chunks.length){if(automatic&&!heard)onSilence();else onFinish(wavFile(chunks,context.sampleRate));}};
  try{
    context=new AudioContext();await context.resume();if(!isCurrent()){cleanup();return null;}
    source=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(2048,1,1);gain=context.createGain();gain.gain.value=0;
    processor.onaudioprocess=e=>{if(stopped)return;const a=e.inputBuffer.getChannelData(0),count=Math.min(a.length,Math.max(0,context.sampleRate*30-samples));if(count<=0){stop();return;}const part=a.slice(0,count);chunks.push(part);samples+=count;const rms=Math.sqrt(part.reduce((sum,n)=>sum+n*n,0)/count),ms=count/context.sampleRate*1000;onLevel(Math.min(1,rms*8));if(rms>.018){speechMs+=ms;lastVoice=samples/context.sampleRate;if(speechMs>=250)heard=true;}const seconds=samples/context.sampleRate;if(automatic&&heard&&seconds-lastVoice>.95)stop();else if(automatic&&!heard&&seconds>8)stop();else if(seconds>=(automatic?20:30))stop();};
    source.connect(processor);processor.connect(gain);gain.connect(context.destination);timer=setTimeout(()=>stop(),automatic?22000:30000);return{stop,stream};
  }catch(e){cleanup();throw e;}
}

/** Decode any browser-supported audio (MP3, M4A, OGG, WebM, FLAC…) into a 16 kHz mono WAV file. */
export async function toWav(file){
  if(/\.wav$/i.test(file.name))return file;
  const context=new AudioContext();
  try{const buffer=await context.decodeAudioData(await file.arrayBuffer());const mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const d=buffer.getChannelData(c);for(let i=0;i<d.length;i++)mono[i]+=d[i]/buffer.numberOfChannels;}
    const wav=wavFile([mono],buffer.sampleRate);return new File([wav],file.name.replace(/\.[^.]+$/,'')+'.wav',{type:'audio/wav'});}
  catch{throw Error(`Could not decode ${file.name} as audio`);}
  finally{context.close();}
}
