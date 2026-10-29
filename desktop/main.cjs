const {app,BrowserWindow,session,systemPreferences,dialog}=require('electron');
let service,win,closing=false,microphoneAllowed=false;
app.setName('QVAC UI');
const ownOrigin=value=>{try{return new URL(value).origin===service?.origin;}catch{return false;}};
const ownWindow=contents=>Boolean(win&&!win.isDestroyed()&&contents===win.webContents&&ownOrigin(contents.getURL()));
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
  app.whenReady().then(async()=>{
    const [{createApp},{startSession}]=await Promise.all([import('../server/app.mjs'),import('../server/session.mjs')]);
    // Shares the configured project .local workspace with npm start and browser
    // launchers. An authenticated existing owner keeps its SQLite connection.
    service=await startSession({createApp,port:Number(process.env.PORT||4317)});
    session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details)=>
      permission==='media'&&details.mediaType==='audio'&&details.isMainFrame&&ownWindow(contents)&&ownOrigin(origin)&&
      (!details.securityOrigin||ownOrigin(details.securityOrigin))&&microphoneAllowed&&
      (process.platform!=='darwin'||systemPreferences.getMediaAccessStatus('microphone')==='granted'));
    session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
      const audioOnly=permission==='media'&&details.isMainFrame&&ownWindow(contents)&&ownOrigin(details.requestingUrl)&&
        (!details.securityOrigin||ownOrigin(details.securityOrigin))&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio';
      if(!audioOnly)return callback(false); // Camera, screen capture and all other permissions stay denied.
      try{
        microphoneAllowed=process.platform==='darwin'?await systemPreferences.askForMediaAccess('microphone'):
          (await dialog.showMessageBox(win,{type:'question',title:'Allow microphone?',message:'Allow QVAC UI to record audio for voice messages?',detail:'The recording is processed by your local models.',buttons:['Allow microphone','Cancel'],defaultId:1,cancelId:1})).response===0;
        callback(microphoneAllowed&&ownWindow(contents)&&ownOrigin(details.requestingUrl));
      }catch{callback(false);}
    });
    win=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:720,backgroundColor:'#0c1015',title:'QVAC UI',
      webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!ownOrigin(url))event.preventDefault();});
    win.webContents.on('will-attach-webview',event=>event.preventDefault());
    session.defaultSession.on('will-download',event=>event.preventDefault()); // The copilot never downloads files.
    await win.loadURL(service.url);
  }).catch(error=>{dialog.showErrorBox('QVAC UI could not start',String(error.message));app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{if(service&&!closing){event.preventDefault();closing=true;service.close().then(()=>app.quit(),()=>app.quit());}});
}
