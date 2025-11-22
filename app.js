/* ============ Helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const byId = id => document.getElementById(id);
const shuffle = arr => { const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const fmtTime = s => { const m=Math.floor(s/60), ss=s%60; return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; };
const download = (fn, txt) => { const blob=new Blob([txt],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=fn; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000); };

/* ============ Auth từ accounts.json ============ */
const LS_SESSION = 'ump_quiz_session_v3';
let accountsConfig = null; // { users: [...] }

async function loadAccounts(){
  try{
    const res = await fetch('accounts.json?ts=' + Date.now(), { cache: 'no-store' });
    if(!res.ok) throw new Error('Không đọc được accounts.json');
    const data = await res.json();
    if(!data.users || !Array.isArray(data.users)){
      throw new Error('accounts.json phải có mảng "users".');
    }
    accountsConfig = data;
  }catch(e){
    console.error(e);
    alert('Lỗi đọc accounts.json: ' + e.message);
  }
}

function getSession(){
  try{ return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); }
  catch{ return null; }
}
function setSession(username){
  localStorage.setItem(LS_SESSION, JSON.stringify({ username }));
}
function clearSession(){
  localStorage.removeItem(LS_SESSION);
}

function findUser(username){
  if(!accountsConfig) return null;
  return accountsConfig.users.find(u => u.username === username);
}

function currentUser(){
  const s = getSession();
  if(!s || !accountsConfig) return null;
  const u = findUser(s.username);
  if(!u) return null;
  return u;
}

function isGuestActive(user){
  if(user.role !== 'guest') return true;      // admin không check hạn
  if(!user.valid_until) return true;         // không set ngày = vô thời hạn
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(user.valid_until); exp.setHours(0,0,0,0);
  return exp >= today;
}

function showAuthOverlay(){
  const ov = byId('authOverlay');
  if(ov) ov.style.display = 'flex';
}
function hideAuthOverlay(){
  const ov = byId('authOverlay');
  if(ov) ov.style.display = 'none';
}

function renderAuthArea(){
  const host = byId('authArea');
  if(!host) return;
  host.innerHTML = '';

  const u = currentUser();
  if(!u) return;

  let status = '—';
  if(u.role === 'admin'){
    status = 'ADMIN (không giới hạn)';
  }else if(u.role === 'guest'){
    status = isGuestActive(u) ? 'Guest — còn hạn' : 'Guest — HẾT HẠN';
  }

  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = `👤 ${u.username} • <b>${status}</b>` +
                   (u.valid_until ? ` • đến: <b>${u.valid_until}</b>` : '');
  host.appendChild(pill);

  const btnLogout = document.createElement('button');
  btnLogout.className = 'btn small ghost';
  btnLogout.textContent = 'Đăng xuất';
  btnLogout.onclick = () => { clearSession(); location.reload(); };
  host.appendChild(btnLogout);
}

function canUseApp(){
  const u = currentUser();
  if(!u){
    showAuthOverlay();
    return false;
  }
  if(u.role === 'admin') return true;
  if(u.role === 'guest' && isGuestActive(u)) return true;
  alert('Tài khoản guest đã hết hạn hoặc chưa được cấp ngày hiệu lực. Liên hệ Admin để chỉnh accounts.json.');
  return false;
}

async function initAuth(){
  await loadAccounts();

  const loginBtn = byId('btnLogin');
  const uInput   = byId('authUser');
  const pInput   = byId('authPassword');

  if(loginBtn){
    loginBtn.addEventListener('click', ()=>{
      if(!accountsConfig){
        alert('Chưa tải được accounts.json.');
        return;
      }
      const name = (uInput.value || '').trim();
      const pass = pInput.value;
      if(!name || !pass){
        alert('Nhập tài khoản và mật khẩu');
        return;
      }
      const u = findUser(name);
      if(!u || u.password !== pass){
        alert('Sai tài khoản hoặc mật khẩu');
        return;
      }
      setSession(name);
      hideAuthOverlay();
      renderAuthArea();
    });
  }

  const cu = currentUser();
  if(cu){
    hideAuthOverlay();
    renderAuthArea();
  }else{
    showAuthOverlay();
  }
}

/* ============ State ============ */
const state = {
  raw:null, quiz:null, orderMap:[], answers:new Map(),
  started:false, submitted:false, secs:0, timer:null,
  current:0, autoShowExp:true, viewFilter:'all'
};

/* ============ Validation / Normalize ============ */
function validateQuiz(json){
  if(!json || typeof json!=='object') throw new Error('File JSON không hợp lệ.');
  if(!Array.isArray(json.questions) || json.questions.length===0) throw new Error('Thiếu danh sách "questions".');

  json.meta = json.meta || {};
  if(!json.meta.title) json.meta.title = 'Đề không tên';

  const ids=new Set();
  json.questions.forEach((q,i)=>{
    if(!q || typeof q!=='object') throw new Error(`Câu ${i+1} không hợp lệ.`);
    if(!q.id) throw new Error(`Câu ${i+1}: thiếu "id".`);
    if(ids.has(q.id)) throw new Error(`Trùng id câu hỏi: ${q.id}`);
    ids.add(q.id);

    if(!q.type) q.type = (Array.isArray(q.correct) && q.correct.length>1)?'multi':'single';
    if(!['single','multi'].includes(q.type)) throw new Error(`Câu ${q.id}: type phải là single|multi.`);
    if(!q.question) throw new Error(`Câu ${q.id}: thiếu "question".`);
    if(!Array.isArray(q.options) || q.options.length<2) throw new Error(`Câu ${q.id}: cần >=2 options.`);
    if(!Array.isArray(q.correct) || q.correct.length===0) throw new Error(`Câu ${q.id}: thiếu mảng "correct".`);
    q.correct.forEach(ix=>{
      if(typeof ix!=='number' || ix<0 || ix>=q.options.length) throw new Error(`Câu ${q.id}: chỉ số correct không hợp lệ.`);
    });
    if(q.type==='single' && q.correct.length!==1) throw new Error(`Câu ${q.id}: dạng single phải có đúng 1 đáp án.`);
    if(q.explanation==null) q.explanation='';
  });
  return json;
}
function normalizeQuiz(json){
  const meta={
    title: json.meta.title || 'Đề không tên',
    time_limit_sec: Number.isInteger(json.meta.time_limit_sec)? json.meta.time_limit_sec : 600,
    shuffle_questions: !!json.meta.shuffle_questions,
    shuffle_options: !!json.meta.shuffle_options,
    pass_mark: typeof json.meta.pass_mark==='number'? json.meta.pass_mark : 0,
  };
  const questions=json.questions.map(q=>({...q}));
  return {meta, questions};
}

/* ============ Import / Loader ============ */
function setHeaderInfo(t){ byId('headerInfo').textContent=t; }

function tryParse(text){
  try{ const json=JSON.parse(text); validateQuiz(json); renderStart(json);}
  catch(e){ alert('Lỗi JSON: '+e.message); console.error(e); }
}
byId('fileInput').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return; tryParse(await f.text());
});
const drop=byId('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.remove('drag');}));
drop.addEventListener('drop', async e=>{ const f=e.dataTransfer.files[0]; if(!f) return; tryParse(await f.text()); });
byId('btnParse').addEventListener('click', ()=>{ const t=byId('paste').value.trim(); if(!t) return alert('Dán JSON trước.'); tryParse(t); });
byId('btnTemplate').addEventListener('click', ()=> download('pharma-quiz-template.json', JSON.stringify(getTemplateJSON(),null,2)));
byId('btnSample').addEventListener('click', ()=> tryParse(JSON.stringify(getTemplateJSON())));

function renderStart(json){
  state.raw=json; state.quiz=normalizeQuiz(json);
  setHeaderInfo(`Đã tải: ${state.quiz.meta.title}`);
  byId('btnStart').disabled=false; byId('btnReset').disabled=false;
}

/* ============ Quiz flow ============ */
byId('btnStart').addEventListener('click', ()=>{
  if(!state.quiz) return;
  if(!canUseApp()) return;
  resetAll(); computeOrder(); startQuiz();
});
byId('btnReset').addEventListener('click', ()=> resetAll());

function computeOrder(){
  const qPol=byId('shuffleQ').value; const wantQ=qPol==='yes'||(qPol==='file'&&state.quiz.meta.shuffle_questions);
  const arr=state.quiz.questions.map((_,i)=>i); const qOrder= wantQ? shuffle(arr): arr;
  state.orderMap = qOrder.map(qIdx=>{
    const q=state.quiz.questions[qIdx];
    const oPol=byId('shuffleO').value; const wantO=oPol==='yes'||(oPol==='file'&&state.quiz.meta.shuffle_options);
    const ord=q.options.map((_,i)=>i);
    return {qIdx, optOrder: wantO? shuffle(ord): ord};
  });
}
function startQuiz(){
  byId('loader').classList.add('hide');
  byId('quizPanel').classList.remove('hide');
  byId('resultPanel').classList.add('hide');
  byId('scorePill').classList.add('hide');
  state.answers.clear(); state.submitted=false; state.current=0;

  renderQuestion(0); renderMatrix(); renderProgressMeta(); applyFilter();

  const minInput=parseInt(byId('minutes').value,10);
  const total=Number.isFinite(minInput)? Math.max(60,minInput*60) : (state.quiz.meta.time_limit_sec||600);
  startTimer(total);
  state.started=true;
}
function startTimer(total){
  clearInterval(state.timer); state.secs=total;
  const tick=()=>{
    byId('headerTimer').textContent=fmtTime(state.secs);
    byId('bigTimer').textContent=fmtTime(state.secs);
    const pct=Math.max(0,Math.min(100,(1-state.secs/total)*100));
    byId('bar').style.width=pct+'%';
    if(state.secs<=0){ clearInterval(state.timer); submitQuiz(true); }
    state.secs--;
  };
  tick(); state.timer=setInterval(tick,1000);
}
function renderProgressMeta(){
  const total=state.orderMap.length;
  const answered=[...state.answers.values()].filter(s=>s.size>0).length;
  byId('sideMeta').textContent = `${answered}/${total} câu`;
}

/* ============ Renderers ============ */
function renderQuestion(qShownIdx){
  const m=state.orderMap[qShownIdx]; const q=state.quiz.questions[m.qIdx]; const isMulti=q.type==='multi';
  byId('qTitle').textContent = `Câu ${qShownIdx+1}`;
  byId('qMeta').textContent  = `${isMulti?'Chọn nhiều':'Chọn một'} • ${state.quiz.questions.length} câu`;
  byId('qText').innerHTML   = q.question;

  const imgHost=byId('qImage'); imgHost.innerHTML='';
  if(q.image){ const img=new Image(); img.src=q.image; img.alt='image'; img.style.maxWidth='100%'; img.style.borderRadius='10px'; imgHost.appendChild(img); }

  const opts=byId('qOpts'); opts.innerHTML='';
  const chosenSet=new Set(state.answers.get(qShownIdx)||[]);
  m.optOrder.forEach((origOptIdx, shownIdx)=>{
    const lab=document.createElement('div'); lab.className='opt';
    if(chosenSet.has(shownIdx)) lab.classList.add('chosen');
    const badge=document.createElement('span'); badge.className='badge'; badge.textContent=String.fromCharCode(65+shownIdx);
    const span=document.createElement('div');  span.innerHTML=q.options[origOptIdx];
    lab.appendChild(badge); lab.appendChild(span); opts.appendChild(lab);
  });

  const exp=byId('qExp'); exp.innerHTML=q.explanation?`💡 <b>Giải thích:</b> ${q.explanation}`:'';
  exp.classList.remove('show');

  if(state.submitted){
    decorateAfterSubmit(qShownIdx);
    if(state.autoShowExp && !checkQuestion(qShownIdx) && q.explanation) exp.classList.add('show');
  }
}
function renderMatrix(){
  const host=byId('qMatrix'); host.innerHTML='';
  state.orderMap.forEach((m,i)=>{
    const q=state.quiz.questions[m.qIdx]; const isMulti=q.type==='multi';
    const row=document.createElement('div'); row.className='mrow'; row.dataset.q=i;

    const num=document.createElement('div'); num.className='mnum'; num.textContent=String(i+1);
    if(i===state.current){ num.classList.add('current'); row.classList.add('current'); }
    num.addEventListener('click',()=>{ setCurrent(i); scrollRowIntoView(i); });
    row.appendChild(num);

    const mopts=document.createElement('div'); mopts.className='mopts';
    const chosen=new Set(state.answers.get(i)||[]);
    m.optOrder.forEach((orig, shownIdx)=>{
      const label=document.createElement('label'); label.className='mopt';
      const input=document.createElement('input'); input.type=isMulti?'checkbox':'radio'; input.name=`mx_${i}`; input.value=String(shownIdx);
      input.checked = chosen.has(shownIdx);
      input.disabled = state.submitted;
      input.addEventListener('change',()=>{ setCurrent(i); onSelect(i, shownIdx, isMulti); });
      const span=document.createElement('span'); span.textContent=String.fromCharCode(65+shownIdx);
      label.appendChild(input); label.appendChild(span); mopts.appendChild(label);
    });
    row.appendChild(mopts);
    host.appendChild(row);
  });
}
function renderMatrixRow(i){
  const host=byId('qMatrix'); const row=host.querySelector(`.mrow[data-q="${i}"]`); if(!row) return;
  $$('#qMatrix .mrow').forEach(r=>r.classList.remove('current','ok','bad'));
  row.classList.add('current');
  $$('#qMatrix .mnum').forEach(n=>n.classList.remove('current'));
  row.querySelector('.mnum').classList.add('current');

  const q=state.quiz.questions[state.orderMap[i].qIdx];
  const chosenSet=new Set(state.answers.get(i)||[]);
  row.querySelectorAll('.mopt').forEach((optLab, idx)=>{
    const input=optLab.querySelector('input');
    input.checked = chosenSet.has(idx);
    if(state.submitted){
      input.disabled = true;
      const origIdx = mapShownToOrig(i, idx);
      optLab.classList.toggle('correct', q.correct.includes(origIdx));
      optLab.classList.toggle('wrong', input.checked && !q.correct.includes(origIdx));
    }else{
      input.disabled = false;
      optLab.classList.remove('correct','wrong');
    }
  });
  if(state.submitted){
    const ok = checkQuestion(i); const answered = chosenSet.size>0;
    row.classList.toggle('ok', ok);
    row.classList.toggle('bad', !ok && answered);
  }
}
function decorateAfterSubmit(qShownIdx){
  const m=state.orderMap[qShownIdx]; const q=state.quiz.questions[m.qIdx];
  const host=byId('qOpts'); const labels=host.querySelectorAll('.opt'); const chosen=[...(state.answers.get(qShownIdx)||[])];
  labels.forEach((lab, shownIdx)=>{
    const origIdx=mapShownToOrig(qShownIdx, shownIdx);
    lab.classList.remove('correct','wrong');
    if(q.correct.includes(origIdx)) lab.classList.add('correct');
    if(chosen.includes(shownIdx) && !q.correct.includes(origIdx)) lab.classList.add('wrong');
  });
}

/* ============ Selection / Navigation ============ */
function onSelect(qShownIdx, optShownIdx, isMulti){
  const set = state.answers.get(qShownIdx) || new Set();
  if(isMulti){ if(set.has(optShownIdx)) set.delete(optShownIdx); else set.add(optShownIdx); }
  else { set.clear(); set.add(optShownIdx); }
  state.answers.set(qShownIdx, set);
  renderMatrixRow(qShownIdx); renderProgressMeta(); applyFilter();
  if(qShownIdx===state.current) renderQuestion(qShownIdx);
}
function mapShownToOrig(qShownIdx, optShownIdx){
  const m=state.orderMap[qShownIdx]; return m.optOrder[optShownIdx];
}
function checkQuestion(qShownIdx){
  const m=state.orderMap[qShownIdx]; const q=state.quiz.questions[m.qIdx];
  const sel=[...(state.answers.get(qShownIdx)||[])].map(i=>mapShownToOrig(qShownIdx,i)).sort((a,b)=>a-b);
  const correct=q.correct.slice().sort((a,b)=>a-b);
  if(sel.length!==correct.length) return false;
  for(let i=0;i<sel.length;i++) if(sel[i]!==correct[i]) return false;
  return true;
}
function setCurrent(i){ state.current=i; renderMatrixRow(i); renderQuestion(i); }
function scrollRowIntoView(i){ const row=byId('qMatrix').querySelector(`.mrow[data-q="${i}"]`); if(row) row.scrollIntoView({block:'nearest'}); }

/* ============ Filter & Submit ============ */
function applyFilter(){
  const mode = state.viewFilter || 'all';
  const rows = $$('#qMatrix .mrow');
  rows.forEach(row=>{
    const idx = +row.dataset.q;
    const answered = (state.answers.get(idx)||new Set()).size>0;
    let show = true;
    if(mode==='answered') show = answered;
    else if(mode==='unanswered') show = !answered;
    row.style.display = show ? '' : 'none';
  });
  const cur = byId('qMatrix').querySelector(`.mrow[data-q="${state.current}"]`);
  if(!cur || cur.style.display==='none'){
    const firstVis = $$('#qMatrix .mrow').find(r=>r.style.display!=='none');
    if(firstVis) setCurrent(+firstVis.dataset.q);
  }
}
function submitQuiz(auto=false){
  if(state.submitted) return; state.submitted=true; clearInterval(state.timer);

  const total=state.orderMap.length; let correct=0; for(let i=0;i<total;i++) if(checkQuestion(i)) correct++;
  const pct= total? Math.round(correct/total*100):0;

  const pill=byId('scorePill'); pill.textContent = `Điểm: ${correct}/${total} (${pct}%)`; pill.classList.remove('hide');

  for(let i=0;i<state.orderMap.length;i++) renderMatrixRow(i);
  decorateAfterSubmit(state.current);

  const wr = byId('wrongList'); wr.innerHTML='';
  const container=document.createElement('div'); container.className='qview';
  state.orderMap.forEach((m, i)=>{
    const ok=checkQuestion(i); if(ok) return; const q=state.quiz.questions[m.qIdx];
    const box=document.createElement('div'); box.className='card pad';
    box.innerHTML = `<div style="margin-bottom:6px"><b>Câu ${i+1}.</b> ${q.question}</div>`;
    const ul=document.createElement('ul'); ul.style.margin='0 0 6px 18px'; ul.style.padding='0';
    q.options.forEach((opt, idx)=>{
      const chosenOrig = [...(state.answers.get(i)||[])].map(s=>mapShownToOrig(i,s));
      const tag = q.correct.includes(idx)? '✓' : (chosenOrig.includes(idx)? '✗' : '·');
      const li=document.createElement('li'); li.textContent = `${tag} ${opt}`; ul.appendChild(li);
    });
    box.appendChild(ul);
    if(q.explanation){ const ex=document.createElement('div'); ex.className='exp show'; ex.innerHTML=`💡 <b>Giải thích:</b> ${q.explanation}`; box.appendChild(ex); }
    container.appendChild(box);
  });
  wr.appendChild(container);
  byId('resultPanel').classList.remove('hide');
  applyFilter();
}

/* ============ Buttons ============ */
byId('btnSubmit').addEventListener('click', ()=> submitQuiz(false));
byId('btnPrev').addEventListener('click', ()=> setCurrent(Math.max(0, state.current-1)));
byId('btnNext').addEventListener('click', ()=> setCurrent(Math.min(state.orderMap.length-1, state.current+1)));
byId('btnReview').addEventListener('click', ()=>{
  state.autoShowExp=!state.autoShowExp;
  const q=state.orderMap[state.current]; if(!q) return;
  const e=byId('qExp');
  if(state.autoShowExp && state.submitted && !checkQuestion(state.current) && (state.quiz.questions[q.qIdx].explanation)) e.classList.add('show');
  else e.classList.remove('show');
});
byId('btnShuffle').addEventListener('click', ()=>{
  if(!state.quiz) return;
  computeOrder(); state.answers.clear(); state.submitted=false; byId('scorePill').classList.add('hide');
  renderQuestion(0); renderMatrix(); renderProgressMeta(); applyFilter();
});
byId('btnRedo').addEventListener('click', ()=>{
  if(!state.quiz) return;
  state.submitted=false; byId('scorePill').classList.add('hide'); state.answers.clear();
  computeOrder(); renderQuestion(0); renderMatrix(); renderProgressMeta(); applyFilter();
  const total = state.quiz.meta.time_limit_sec || 600; startTimer(total);
});
byId('btnNew').addEventListener('click', ()=>{
  clearInterval(state.timer); state.started=false; state.submitted=false;
  state.answers.clear(); state.orderMap=[]; state.current=0;
  byId('loader').classList.remove('hide'); byId('quizPanel').classList.add('hide');
  byId('resultPanel').classList.add('hide'); byId('scorePill').classList.add('hide');
  byId('headerTimer').textContent='00:00'; byId('bigTimer').textContent='00:00'; byId('bar').style.width='0%';
  setHeaderInfo('Chưa tải đề');
});
byId('filterGroup').addEventListener('click', e=>{
  const b=e.target.closest('.chip'); if(!b) return;
  $$('#filterGroup .chip').forEach(c=>c.classList.remove('active'));
  b.classList.add('active'); state.viewFilter=b.dataset.filter; applyFilter();
});

/* ============ Help Modal ============ */
const helpModal=byId('helpModal');
const btnHelp=byId('btnHelp');
const helpClose=byId('helpClose');
const openHelp=()=>{ helpModal.classList.add('show'); helpModal.classList.remove('hide'); helpModal.setAttribute('aria-hidden','false'); };
const closeHelp=()=>{ helpModal.classList.remove('show'); helpModal.classList.add('hide'); helpModal.setAttribute('aria-hidden','true'); };
btnHelp.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
helpModal.addEventListener('click', e=>{ if(e.target===helpModal) closeHelp(); });
window.addEventListener('keydown', e=>{ if(e.key==='Escape' && helpModal.classList.contains('show')) closeHelp(); });

/* ============ Reset All ============ */
function resetAll(){
  clearInterval(state.timer); state.started=false; state.submitted=false;
  state.answers.clear(); state.orderMap=[]; state.current=0;
  byId('loader').classList.remove('hide'); byId('quizPanel').classList.add('hide');
  byId('resultPanel').classList.add('hide'); byId('scorePill').classList.add('hide');
  byId('headerTimer').textContent='00:00'; byId('bigTimer').textContent='00:00'; byId('bar').style.width='0%';
  setHeaderInfo(state.quiz?`Đã tải: ${state.quiz.meta.title}`:'Chưa tải đề');
}

/* ============ Template JSON sample ============ */
function getTemplateJSON(){
  return {
    meta:{
      title:'Dược lý – Đề mẫu 01',
      time_limit_sec:900,
      shuffle_questions:true,
      shuffle_options:true,
      pass_mark:0.5,
      version:'1.0'
    },
    questions:[
      { id:'DL01', type:'single', question:'Đo nồng độ đáy (trough) thích hợp cho thuốc có:',
        options:['Khoảng điều trị hẹp','Thể tích phân bố lớn','Sinh khả dụng cao','Hệ số chiết xuất gan cao','Tốc độ hòa tan thấp'],
        correct:[0], explanation:'Thuốc có cửa sổ điều trị hẹp thường cần TDM bằng nồng độ đáy để tối ưu liều và tránh độc tính.', tags:['Dược động học','TDM'], difficulty:'medium' },
      { id:'DL02', type:'multi', question:'Chọn các phát biểu đúng về omeprazole:',
        options:['Là tiền thuốc','Kích hoạt ở môi trường kiềm','Ức chế bơm H⁺/K⁺-ATPase','Tác dụng dược lý ngắn hơn thời gian ức chế enzym'],
        correct:[0,2], explanation:'Omeprazole là tiền thuốc, hoạt hoá trong môi trường acid và ức chế không hồi phục bơm proton.', tags:['Hóa dược','PPI'], difficulty:'easy' },
      { id:'DL03', type:'single', question:'Tác dụng không mong muốn khi dùng cam thảo kéo dài là:',
        options:['Tiêu chảy','Phù','Chảy máu','Phát ban'], correct:[1],
        explanation:'Glycyrrhizin gây giả cường aldosteron → giữ muối nước → phù.', tags:['Dược liệu'], difficulty:'easy' }
    ]
  };
}

/* ============ Init header text & Auth ============ */
setHeaderInfo('Chưa tải đề');
initAuth();
