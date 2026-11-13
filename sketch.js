/* Galaxy Shoot — browser edition, no libraries or network required.
 * Based on the gameplay of galaxy shoot.pde. Drawn with a native Canvas2D
 * perspective camera so it runs from a local HTML file without Processing/p5.
 */
(() => {
  'use strict';
  const W=960, TAU=Math.PI*2;
  let H=720;
  const EZ=-560, PZ=220;
  const PARRY_WINDOW=7, PARRY_FAIL_COOLDOWN=78;
  const CAM={x:0,y:-120,z:580}, TARGET={x:0,y:-5,z:-300};
  const fwd={y:TARGET.y-CAM.y,z:TARGET.z-CAM.z};
  const fn=Math.hypot(fwd.y,fwd.z); fwd.y/=fn; fwd.z/=fn;
  const focal=H/(2*Math.tan(Math.PI/6));
  const $=sel=>document.querySelector(sel);
  const canvas=$('#game'), ctx=canvas.getContext('2d',{alpha:false});
  const startButton=$('#start-button'), status=$('#game-status');
  const parryButton=$('#parry-button'), pauseButton=$('#pause-button');
  let pointerTarget=null, activeTouch=null;
  const keys=new Set();
  const rand=(a,b)=>a+Math.random()*(b-a);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const patterns=['GRID','V-FORM','WAVE','RING'];
  let state='title',score=0,lives=3,wave=1,tick=0,lastPattern=-1,pattern=0;
  let px=0,py=90,enemyDir=1,enemySpeed=1.5,formationX=0;
  let fireCooldown=0,enemyFireTimer=70,invincible=0,waveWait=-1;
  let parryFrames=0,parryCooldown=0,parrySuccessFlash=0,parryFailFlash=0;
  let enemies=[],bullets=[],sparks=[],stars=[],scroll=0;

  // Keep the world horizontally consistent while providing a tall playfield
  // in phone portrait mode. Height changes to match the CSS canvas ratio.
  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;
    const newH=clamp(Math.round(W*rect.height/rect.width),720,1900);
    if(newH!==H){H=newH;canvas.height=H;}
  }
  // Invert the camera perspective at the player's Z depth so the ship
  // actually follows the cursor, rather than shifting in the wrong direction.
  function mouseToShip(clientX,clientY){
    const rect=canvas.getBoundingClientRect();
    const sx=(clientX-rect.left)*W/rect.width;
    const sy=(clientY-rect.top)*H/rect.height;
    const ratio=(sy-H/2)/focal;
    const denom=ratio*fwd.y+fwd.z;
    if(Math.abs(denom)<1e-6)return {x:px,y:py};
    const y=CAM.y+(PZ-CAM.z)*(fwd.y-ratio*fwd.z)/denom;
    const depth=(y-CAM.y)*fwd.y+(PZ-CAM.z)*fwd.z;
    const x=CAM.x+(sx-W/2)*depth/focal;
    return {x:clamp(x,-280,280),y:clamp(y,-125,135)};
  }
  function project(x,y,z){
    const dx=x-CAM.x,dy=y-CAM.y,dz=z-CAM.z;
    const depth=dy*fwd.y+dz*fwd.z;
    if(depth<=2) return null;
    const down=dy*(-fwd.z)+dz*fwd.y;
    const s=focal/depth;
    return {x:W/2+dx*s,y:H/2+down*s,s,depth};
  }
  function worldPoly(pts, fill, stroke, line=1){
    const projected=pts.map(v=>project(...v));
    if(projected.some(p=>!p))return;
    ctx.beginPath(); ctx.moveTo(projected[0].x,projected[0].y);
    for(let i=1;i<projected.length;i++)ctx.lineTo(projected[i].x,projected[i].y);
    ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=line;ctx.stroke();}
  }
  function line3(a,b,color,w=1){
    const A=project(...a),B=project(...b);
    if(!A||!B)return;
    ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();
  }
  function orb3(x,y,z,r,color,halo=0){
    const p=project(x,y,z);if(!p)return;
    const rr=clamp(r*p.s,0.5,120);
    if(halo){const gr=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,rr*3);
      gr.addColorStop(0,color);gr.addColorStop(1,'transparent');ctx.globalAlpha=.24;
      ctx.fillStyle=gr;ctx.beginPath();ctx.arc(p.x,p.y,rr*3,0,TAU);ctx.fill();ctx.globalAlpha=1;}
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,rr,0,TAU);ctx.fill();
  }
  function makeStars(){stars=Array.from({length:290},()=>({x:rand(-1600,1600),y:rand(-850,650),z:rand(-2900,430),v:rand(5,15),r:rand(.6,2.5)}));}
  function resetStar(s){s.x=rand(-1600,1600);s.y=rand(-850,650);s.z=-2900;s.v=rand(5,15);}
  function fireRate(){return Math.min(3,1+(wave-1)*.1);}
  function scheduleShot(){enemyFireTimer=Math.max(1,Math.round(rand(42,85)/fireRate()));}
  function patternEnemy(tx,ty,type){
    const mode=Math.floor(rand(0,3));let x,y,z;
    if(mode===0){x=tx*1.8;y=ty+rand(-90,90);z=-2300-rand(0,400);}
    else if(mode===1){x=Math.random()<.5?-850:850;y=ty+rand(-80,80);z=-1900-rand(0,400);}
    else{x=tx+rand(-500,500);y=ty+rand(-120,120);z=-2600;}
    enemies.push({x,y,z,tx,ty,type,points:40-type*10,
      arriveRate:rand(.07,.11),arriving:true,age:0,phase:rand(0,TAU),angle:0});
  }
  function createWave(){
    enemies=[];bullets=[];enemyDir=1;formationX=0;
    enemySpeed=Math.min(1.2+wave*.18,3.2);
    enemyFireTimer=Math.round(70/fireRate());waveWait=-1;
    do{pattern=Math.floor(rand(0,4));}while(pattern===lastPattern);
    lastPattern=pattern;
    if(pattern===0){for(let r=0;r<3;r++)for(let c=0;c<7;c++)patternEnemy((c-3)*70,-78+r*72,r);}
    if(pattern===1){for(let i=-4;i<=4;i++)patternEnemy(i*55,-65+Math.abs(i)*24,Math.abs(i)%3);
      for(let i=-3;i<=3;i++)patternEnemy(i*53,30+Math.abs(i)*22,(Math.abs(i)+1)%3);}
    if(pattern===2){for(let i=0;i<17;i++)patternEnemy(-230+i*460/16,Math.sin(i*.7)*78,i%3);}
    if(pattern===3){for(let i=0;i<18;i++){
      const a=TAU*i/18;patternEnemy(Math.cos(a)*205,Math.sin(a)*86,i%3);
      enemies[enemies.length-1].angle=a;
    }}
  }
  function newGame(){
    score=0;lives=3;wave=1;tick=0;lastPattern=-1;px=0;py=90;
    fireCooldown=0;invincible=0;waveWait=-1;parryFrames=0;parryCooldown=0;
    parrySuccessFlash=0;parryFailFlash=0;bullets=[];sparks=[];keys.clear();
    pointerTarget=null;activeTouch=null;
    createWave();state='playing';startButton.hidden=true;status.textContent='';
    pauseButton.textContent='일시정지';
  }
  function parry(){if(state==='playing'&&parryCooldown===0&&parryFrames===0)parryFrames=PARRY_WINDOW;}
  function perfectParry(){
    parryFrames=0;parryCooldown=0;parrySuccessFlash=25;parryFailFlash=0;score+=50;
    explode(px,py,PZ,'#38f6ff');
    bullets.push({x:px,y:py,z:PZ-55,vx:0,vy:0,vz:-60,friendly:true});
  }
  function updateParryButton(){
    parryButton.disabled=(state!=='playing'||parryCooldown>0||parryFrames>0);
    parryButton.textContent=parryFrames>0?'방어 중':parryCooldown>0?`패링 ${(parryCooldown/60).toFixed(1)}s`:'패링';
  }
  function updateParry(){
    if(parrySuccessFlash>0)parrySuccessFlash--;
    if(parryFailFlash>0)parryFailFlash--;
    if(parryCooldown>0)parryCooldown--;
    if(parryFrames>0){parryFrames--;if(parryFrames===0){parryCooldown=PARRY_FAIL_COOLDOWN;parryFailFlash=25;}}
  }
  function explode(x,y,z,color){for(let i=0;i<27;i++)sparks.push({x,y,z,vx:rand(-6,6),vy:rand(-6,6),vz:rand(-6,6),life:rand(18,34),color,r:rand(2,5)});}
  function shot(x,y,z,vx,vy,vz,friendly){bullets.push({x,y,z,vx,vy,vz,friendly});}
  function hitBox(a,b,cx,cy,cz,rx,ry,rz){
    const centers=[cx,cy,cz],radii=[rx,ry,rz],orig=[a.x,a.y,a.z],delta=[b.x-a.x,b.y-a.y,b.z-a.z];
    let tmin=0,tmax=1;
    for(let i=0;i<3;i++){
      const low=centers[i]-radii[i], high=centers[i]+radii[i];
      if(Math.abs(delta[i])<1e-7){if(orig[i]<low||orig[i]>high)return false;}
      else{let t1=(low-orig[i])/delta[i],t2=(high-orig[i])/delta[i];
        if(t1>t2)[t1,t2]=[t2,t1];tmin=Math.max(tmin,t1);tmax=Math.min(tmax,t2);
        if(tmin>tmax)return false;}
    }
    return true;
  }
  function updateStep(){
    scroll+=1;
    for(const s of stars){s.z+=s.v;if(s.z>510)resetStar(s);}
    for(let i=sparks.length-1;i>=0;i--){const a=sparks[i];a.x+=a.vx;a.y+=a.vy;a.z+=a.vz;
      a.vx*=.97;a.vy*=.97;a.vz*=.97;if(--a.life<=0)sparks.splice(i,1);}
    if(state!=='playing')return;
    tick++;
    const moveX=Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA'));
    const moveY=Number(keys.has('ArrowDown')||keys.has('KeyS'))-Number(keys.has('ArrowUp')||keys.has('KeyW'));
    const norm=moveX&&moveY?Math.SQRT1_2:1;
    if(moveX||moveY){
      pointerTarget=null;
      px=clamp(px+5.5*moveX*norm,-280,280);
      py=clamp(py+5.5*moveY*norm,-125,135);
    }else if(pointerTarget){
      px=lerp(px,pointerTarget.x,.52);
      py=lerp(py,pointerTarget.y,.52);
    }
    // Automatically fire every 9 frames (~6.7 shots/second), including touch.
    if(fireCooldown>0)fireCooldown--;
    if(fireCooldown===0){shot(px,py,PZ-55,0,0,-52,true);fireCooldown=9;}
    if(invincible>0)invincible--;
    if(enemies.length&&pattern!==3){
      let min=Infinity,max=-Infinity;
      for(const e of enemies){min=Math.min(min,e.tx);max=Math.max(max,e.tx);}
      if(formationX+max>=245||formationX+min<=-245)enemyDir*=-1;
      formationX+=enemyDir*enemySpeed*(pattern===2?.8:1);
    }
    for(const e of enemies){
      if(e.arriving){
        const tx=e.tx+(pattern===3?0:formationX);
        e.x=lerp(e.x,tx,e.arriveRate);e.y=lerp(e.y,e.ty,e.arriveRate);e.z=lerp(e.z,EZ,e.arriveRate);
        if(Math.abs(e.x-tx)<4&&Math.abs(e.y-e.ty)<4&&Math.abs(e.z-EZ)<9){e.arriving=false;e.z=EZ;}
      }else{
        e.age++;
        if(pattern===3){const a=e.angle+e.age*.008;e.x=Math.cos(a)*205;e.y=Math.sin(a)*86;}
        else{e.x=clamp(e.tx+formationX,-260,260);e.y=clamp(e.ty+Math.sin(e.age*.04+e.phase)*(pattern===2?14:7),-105,105);}
      }
    }
    if(--enemyFireTimer<=0){const ready=enemies.filter(e=>!e.arriving);
      if(ready.length){const e=ready[Math.floor(rand(0,ready.length))],dx=px-e.x,dy=py-e.y,dz=PZ-e.z;
        const len=Math.hypot(dx,dy,dz)||1;shot(e.x,e.y,e.z+20,9*dx/len,9*dy/len,9*dz/len,false);}
      scheduleShot();
    }
    // Moving-segment collision remains accurate when bullets skip across an object.
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i],prev={x:b.x,y:b.y,z:b.z};
      b.x+=b.vx;b.y+=b.vy;b.z+=b.vz;
      if(b.z<-3000||b.z>700||Math.abs(b.x)>1400||Math.abs(b.y)>1000){bullets.splice(i,1);continue;}
      let hit=false;
      if(b.friendly){
        for(let j=enemies.length-1;j>=0;j--){const e=enemies[j];
          if(hitBox(prev,b,e.x,e.y,e.z,32,25,30)){
            score+=e.points;explode(e.x,e.y,e.z,'#ffa14d');enemies.splice(j,1);hit=true;break;
          }
        }
      }else if(hitBox(prev,b,px,py,PZ,24,20,35)){
        if(invincible>0){hit=true;}
        else if(parryFrames>0){perfectParry();hit=true;}
        else{lives--;invincible=100;explode(px,py,PZ,'#ff5f76');hit=true;
          if(lives<=0){state='over';status.textContent='게임 오버';startButton.textContent='다시 시작';startButton.hidden=false;}}
      }
      if(hit)bullets.splice(i,1);
    }
    // Collision checks occur before advancing the 7-frame parry window.
    updateParry();
    if(state==='playing'&&enemies.length===0){
      if(waveWait<0){waveWait=100;score+=250;}
      else if(--waveWait<=0){wave++;createWave();}
    }
  }
  function drawStars(){
    for(const s of stars){const p=project(s.x,s.y,s.z);if(!p||p.x<0||p.x>W||p.y<0||p.y>H)continue;
      const rr=clamp(s.r*p.s*1.4,.4,3.6);
      ctx.fillStyle=`rgba(192,221,255,${clamp(.3+p.s*.45,.3,1)})`;
      ctx.fillRect(p.x,p.y,rr,rr);
      if(s.z>200){const q=project(s.x,s.y,s.z-s.v*4);if(q){ctx.strokeStyle='rgba(80,174,255,.35)';ctx.lineWidth=rr;
        ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(p.x,p.y);ctx.stroke();}}
    }
  }
  function drawGrid(){
    for(let z=-2500;z<=350;z+=135)line3([-750,250,z],[750,250,z],'rgba(29,109,173,.16)');
    for(let x=-750;x<=750;x+=100)line3([x,250,-2500],[x,250,350],'rgba(34,124,194,.18)');
  }
  function shipEnemy(e){
    const x=e.x,y=e.y,z=e.z;
    const colors=['#ff5373','#ffa03d','#51eba3'];
    const base=colors[e.type],w=e.arriving?1:1.05;
    // A visible cockpit and projecting wings with 3D depth cues.
    worldPoly([[x-33*w,y+4,z+18],[x-7,y-8,z-21],[x+7,y-8,z-21],[x+33*w,y+4,z+18]],base,'#f9c8d4',1.2);
    worldPoly([[x-33*w,y+4,z+18],[x-42*w,y+5,z+31],[x-3,y+12,z+9],[x,y+2,z-13]],'#465474','#aec3dc',.8);
    worldPoly([[x+33*w,y+4,z+18],[x+42*w,y+5,z+31],[x+3,y+12,z+9],[x,y+2,z-13]],'#465474','#aec3dc',.8);
    worldPoly([[x-9,y-7,z-9],[x,y-16,z-25],[x+9,y-7,z-9],[x+8,y+5,z+15],[x-8,y+5,z+15]],'#192a57','#7df4ff',.9);
    orb3(x,y-10,z+8,4,'#fff0a5',2);
    orb3(x-29,y+3,z+19,4,'#ff4d7d',2);orb3(x+29,y+3,z+19,4,'#ff4d7d',2);
    if(e.arriving){orb3(x,y+2,z+39,6,'#ff9b32',3);}
  }
  function shipPlayer(){
    const x=px,y=py,z=PZ;
    if(invincible&&tick%8<4)return;
    const tilt=(Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')))*7;
    ctx.save();
    worldPoly([[x,y-5,z-69],[x-16+tilt,y+4,z-18],[x-18+tilt,y+8,z+49],[x+18+tilt,y+8,z+49],[x+16+tilt,y+4,z-18]],'#becce4','#f9ffff',1.5);
    worldPoly([[x-9,y+6,z-20],[x-69+tilt,y+9,z+28],[x-56+tilt,y+11,z+42],[x-4,y+7,z+19]],'#277bd8','#8de8ff',1.4);
    worldPoly([[x+9,y+6,z-20],[x+69+tilt,y+9,z+28],[x+56+tilt,y+11,z+42],[x+4,y+7,z+19]],'#277bd8','#8de8ff',1.4);
    worldPoly([[x-10,y-8,z+4],[x,y-19,z-24],[x+10,y-8,z+4],[x+12,y+2,z+16],[x-12,y+2,z+16]],'#03d8ff','#e2ffff',1);
    orb3(x-12,y+5,z+45,7,'#3aefff',3);orb3(x+12,y+5,z+45,7,'#3aefff',3);
    orb3(x-58+tilt,y+5,z+31,4,'#ff4f69',2);orb3(x+58+tilt,y+5,z+31,4,'#ff4f69',2);
    ctx.restore();
  }
  function drawBullets(){
    for(const b of bullets){const p=project(b.x,b.y,b.z),q=project(b.x-b.vx*2,b.y-b.vy*2,b.z-b.vz*2);
      if(!p||!q)continue;
      const color=b.friendly?'#4cffff':'#ff5273';
      ctx.save();ctx.shadowBlur=16;ctx.shadowColor=color;ctx.strokeStyle=color;
      ctx.lineWidth=clamp(p.s*(b.friendly?6:8),2,15);ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x,p.y,clamp(p.s*3,2,7),0,TAU);ctx.fill();
    }
  }
  function drawSparks(){for(const s of sparks){const p=project(s.x,s.y,s.z);if(!p)continue;ctx.globalAlpha=clamp(s.life/32,0,1);
    ctx.fillStyle=s.color;ctx.fillRect(p.x,p.y,Math.max(1,s.r*p.s),Math.max(1,s.r*p.s));}ctx.globalAlpha=1;}
  function text(str,x,y,size,color='#fff',align='center',bold=true){
    ctx.font=`${bold?'700':'400'} ${size}px system-ui,Arial,sans-serif`;
    ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(str,x,y);
  }
  function reticle(){const p=project(px,py,EZ);if(!p)return;
    ctx.save();ctx.strokeStyle='#37efff';ctx.lineWidth=2;ctx.shadowBlur=9;ctx.shadowColor='#21e3ff';
    ctx.beginPath();ctx.arc(p.x,p.y,14,0,TAU);ctx.stroke();
    for(const [dx,dy,dX,dY] of [[-24,0,-10,0],[10,0,24,0],[0,-24,0,-10],[0,10,0,24]]){
      ctx.beginPath();ctx.moveTo(p.x+dx,p.y+dy);ctx.lineTo(p.x+dX,p.y+dY);ctx.stroke();}
    ctx.fillStyle='#8efbff';ctx.fillRect(p.x-2,p.y-2,4,4);ctx.restore();
  }
  function drawHUD(){
    const mobile=H>850;
    ctx.fillStyle='rgba(0,6,23,.75)';ctx.fillRect(0,0,W,mobile?90:71);
    text(`SCORE ${score}`,20,38,mobile?28:21,'#5ef3ff','left');
    text(`WAVE ${wave} [${patterns[pattern]}]`,W/2,38,mobile?26:20,'#5ef3ff');
    text(`LIVES ${lives}`,W-20,38,mobile?28:21,'#ff7794','right');
    text(`ENEMY FIRE x${fireRate().toFixed(1)}`,W/2,mobile?116:95,mobile?26:17,'#f7dd77');
    const parryText=parryFrames>0?'PARRY ACTIVE!':parryCooldown>0?`PARRY COOLDOWN ${(parryCooldown/60).toFixed(2)}s`:'PARRY READY';
    text(parryText,W/2,H-85,mobile?26:17,parryFrames>0?'#36ffff':parryCooldown>0?'#ffab72':'#83ffc3');
    ctx.fillStyle='#283855';ctx.fillRect(394,H-69,172,7);
    ctx.fillStyle='#4beeff';ctx.fillRect(394,H-69,172*(1-parryCooldown/PARRY_FAIL_COOLDOWN),7);
    if(parrySuccessFlash>0)text('PERFECT PARRY! +50',W/2,H/2-75,33,'#47ffff');
    if(parryFailFlash>0)text('PARRY FAILED!',W/2,H/2-75,29,'#ff7b77');
    if(waveWait>0&&enemies.length===0){text('WAVE CLEAR!',W/2,H/2-95,38,'#ffe46f');text('BONUS +250',W/2,H/2-52,22);}
    text(mobile?'DRAG : MOVE     AUTO FIRE     PARRY BUTTON':'MOUSE / WASD : MOVE    AUTO FIRE    SHIFT : PARRY    P : PAUSE',W/2,H-23,mobile?24:14,'#afc7e6', 'center',false);
  }
  function overlay(){
    ctx.fillStyle='rgba(0,4,20,.79)';ctx.fillRect(0,0,W,H);
    const offset=(H-720)/2;
    if(state==='title'){
      text('3D SPACE',W/2,163+offset,61,'#47eaff');text('SHOOTER',W/2,238+offset,70,'#ff6188');
      text('AUTO FIRE · PERFECT PARRY',W/2,310+offset,24);
      text('TAP / ENTER TO START',W/2,411+offset,30,'#ffe47b');
      ['마우스 이동 / 터치 드래그 : 우주선 이동','자동 연사 : 발사 버튼 불필요','SHIFT / 패링 버튼 : 패링 (0.12초)',
       '패링 실패 시 재사용 대기 1.3초','P / 일시정지 버튼 : 일시정지'].forEach((s,i)=>text(s,W/2,475+offset+i*32,19,'#c7defb', 'center',false));
    }else if(state==='paused'){
      text('PAUSED',W/2,346+offset,53);text('P / BUTTON TO RESUME',W/2,412+offset,23);
    }else if(state==='over'){
      text('GAME OVER',W/2,259+offset,67,'#ff5e7e');
      text(`FINAL SCORE : ${score}`,W/2,354+offset,30);text(`WAVE : ${wave}`,W/2,408+offset,28);
      text('TAP / R TO RESTART',W/2,522+offset,25,'#53f0ff');
    }
  }
  function render(){
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#040b22');g.addColorStop(.55,'#080d2b');g.addColorStop(1,'#010713');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const rad=ctx.createRadialGradient(W/2,H*.48,40,W/2,H*.48,530);
    rad.addColorStop(0,'rgba(39,60,119,.24)');rad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=rad;ctx.fillRect(0,0,W,H);
    drawStars();drawGrid();
    enemies.slice().sort((a,b)=>a.z-b.z).forEach(shipEnemy);
    drawBullets();drawSparks();shipPlayer();
    if(parryFrames>0||parrySuccessFlash>0){const p=project(px,py,PZ);
      if(p){const radius=(parryFrames>0?50:50+(25-parrySuccessFlash)*2)*p.s;
        ctx.save();ctx.strokeStyle=`rgba(42,246,255,${parryFrames>0?.85:.55*parrySuccessFlash/25})`;
        ctx.lineWidth=3;ctx.shadowBlur=25;ctx.shadowColor='#2bf3ff';
        ctx.beginPath();ctx.ellipse(p.x,p.y,radius,radius*.67,0,0,TAU);ctx.stroke();ctx.restore();}}
    if(state==='playing'){drawHUD();reticle();} else overlay();
  }
  function startOrRestart(){newGame();}
  function togglePause(){
    if(state==='playing'){state='paused';status.textContent='일시정지';pauseButton.textContent='계속하기';}
    else if(state==='paused'){state='playing';status.textContent='';pauseButton.textContent='일시정지';}
  }
  // Touch is relative drag: finger need not cover the ship. Mouse is absolute.
  function handlePointerMove(e){
    if(e.pointerType==='mouse'){
      if(state==='playing')pointerTarget=mouseToShip(e.clientX,e.clientY);
      return;
    }
    if(!activeTouch||e.pointerId!==activeTouch.id)return;
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const dx=(e.clientX-activeTouch.clientX)/rect.width;
    const dy=(e.clientY-activeTouch.clientY)/rect.height;
    pointerTarget={
      x:clamp(activeTouch.x+dx*560,-280,280),
      y:clamp(activeTouch.y+dy*(460*H/720),-125,135)
    };
  }
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'||e.pointerType==='pen')e.preventDefault();
    if(state==='title'||state==='over')startOrRestart();
    if(state!=='playing')return;
    if(e.pointerType==='touch'||e.pointerType==='pen'){
      if(activeTouch)return; // ignore a second finger; avoid accidental jumps
      activeTouch={id:e.pointerId,clientX:e.clientX,clientY:e.clientY,x:px,y:py};
      try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    }else pointerTarget=mouseToShip(e.clientX,e.clientY);
  },{passive:false});
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||e.pointerType==='pen')e.preventDefault();
    if(state==='playing')handlePointerMove(e);
  },{passive:false});
  function endPointer(e){if(activeTouch&&activeTouch.id===e.pointerId)activeTouch=null;}
  canvas.addEventListener('pointerup',endPointer);
  canvas.addEventListener('pointercancel',endPointer);
  parryButton.addEventListener('pointerdown',e=>{
    e.preventDefault();
    parry();
  },{passive:false});
  parryButton.addEventListener('click',e=>{if(e.detail===0)parry();});
  pauseButton.addEventListener('click',togglePause);
  window.addEventListener('resize',resizeCanvas);
  window.addEventListener('orientationchange',()=>requestAnimationFrame(resizeCanvas));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state==='playing')togglePause();
  });
  document.addEventListener('keydown',e=>{
    if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight','Enter','NumpadEnter'].includes(e.code)) e.preventDefault();
    const fresh=!keys.has(e.code);keys.add(e.code);
    if(!fresh||e.repeat)return;
    if(e.code==='ShiftLeft'||e.code==='ShiftRight')parry();
    else if((e.code==='Enter'||e.code==='NumpadEnter')&&state==='title')startOrRestart();
    else if(e.code==='KeyR')startOrRestart();
    else if(e.code==='KeyP')togglePause();
  },{passive:false});
  document.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>keys.clear());
  startButton.addEventListener('click',startOrRestart);
  makeStars();createWave();resizeCanvas();
  let last=0,accumulator=0;
  function loop(t){
    if(!last)last=t;accumulator=Math.min(accumulator+Math.min(100,t-last),100);last=t;
    while(accumulator>=1000/60){updateStep();accumulator-=1000/60;}
    render();updateParryButton();requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  // Minimal instrumentation used only for automated smoke tests.
  window.__galaxyTest={get state(){return state;},get score(){return score;},get lives(){return lives;},get wave(){return wave;},get position(){return {x:px,y:py};},get shotCount(){return bullets.filter(b=>b.friendly).length;},get canvasHeight(){return H;},start:startOrRestart};
})();
