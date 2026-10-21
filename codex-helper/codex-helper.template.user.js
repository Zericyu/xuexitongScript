// ==UserScript==
// @name         学习通 Codex 章节练习助手
// @namespace    local.codex.xuexitong.chapter-helper
// @version      4.0.4
// @description  正常播放视频，使用本机 Codex 完成视频后的章节测验
// @author       Codex
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @noframes
// ==/UserScript==
// Based on upstream 9a23b35, with local player validation and Codex integration.
(function xuexitongMain() {
const PAGE = unsafeWindow;
const window = PAGE;
const $ = (...args) => PAGE.jQuery(...args);
const APP_KEY = '__xuexitongCodexQuiz';
const BOOT_TIMER_KEY = '__xuexitongCodexQuizBootTimer';
if(PAGE.__xuexitongPlayerV3?.destroy) PAGE.__xuexitongPlayerV3.destroy();
const LOCAL_URL = 'http://127.0.0.1:__LOCAL_PORT__';
let userStopped=false;
function stoppedByUser(){return userStopped;}
const LOCAL_TOKEN = '__LOCAL_TOKEN__';
if (PAGE[APP_KEY]?.destroy) PAGE[APP_KEY].destroy();
if (PAGE[BOOT_TIMER_KEY]) clearInterval(PAGE[BOOT_TIMER_KEY]);
const panel = document.createElement('div');
panel.id = 'codex-quiz-panel';
document.getElementById(panel.id)?.remove();
panel.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483646;background:#fff;color:#172b4d;padding:12px 16px;border:1px solid #bcccdc;border-radius:10px;box-shadow:0 3px 12px #0002;font:14px sans-serif;max-width:380px';
const statusText = document.createElement('div');
statusText.textContent = 'Codex 学习助手：正在连接';
const stopButton = document.createElement('button');
stopButton.textContent = '停止助手';
stopButton.style.cssText = 'margin-top:8px;padding:4px 12px;cursor:pointer';
stopButton.onclick = () => { PAGE[APP_KEY]?.destroy(); setStatus('已停止；刷新页面可重新启动'); };
panel.append(statusText, stopButton); document.body.append(panel);
function setStatus(message) { statusText.textContent = 'Codex 学习助手：' + message; if(PAGE[APP_KEY]) PAGE[APP_KEY].quizStatus = message; }
function bridgeRequest(path, payload, timeout = 190000) {
return new Promise((resolve, reject) => GM_xmlhttpRequest({
method: payload ? 'POST' : 'GET', url: LOCAL_URL + path,
headers: { 'Content-Type': 'application/json', 'X-Xuexitong-Token': LOCAL_TOKEN },
data: payload ? JSON.stringify(payload) : undefined, timeout,
onload(response) { let data; try { data=JSON.parse(response.responseText); } catch { return reject(new Error('本机服务响应不是 JSON')); }
if(response.status<200||response.status>=300) reject(new Error(data.error || '本机服务出错')); else resolve(data); },
onerror: () => reject(new Error('无法连接本机 Codex 服务，请先运行启动程序')),
ontimeout: () => reject(new Error('Codex 调用超时，本次未提交')),
}));
}
bridgeRequest('/health', null, 5000).then(() => {
if (!PAGE.jQuery) throw new Error('当前页面缺少 jQuery，请刷新后重试');
setStatus('已连接，等待课程页'); waitForCoursePage();
}).catch(error => setStatus(error.message));
function waitForCoursePage() {
let attempts = 0;
const maxAttempts = 20;
PAGE[BOOT_TIMER_KEY] = setInterval(() => {
if ($('#coursetree').length > 0) {
clearInterval(PAGE[BOOT_TIMER_KEY]);
PAGE[BOOT_TIMER_KEY] = null;
initializePlayer();
return;
}
attempts++;
if (attempts >= maxAttempts) {
clearInterval(PAGE[BOOT_TIMER_KEY]);
PAGE[BOOT_TIMER_KEY] = null;
console.error('%c脚本启动超时：未检测到课程目录（#coursetree）。请确认当前处于课程播放页。', 'color:#F44336;font-weight:bold');
}
}, 1000);
}
function attachQuizAutomation(app) {
const attemptedQuizzes = new Set();
let quizBusy = false;
let stopped = false;
const originalDestroy = app.destroy.bind(app);
app.lastQuizResult = null;
app.destroy = function () {
stopped = true; userStopped=true;
app._getVideoEl()?.pause();
originalDestroy();
};

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const visible = (el) => Boolean(el && el.isConnected && el.getClientRects().length &&
el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden');
const kindPattern = /[\[【](单选题|多选题|判断题)[\]】]/;

function courseDocuments() {
const result = [];
const visit = (doc, depth) => {
if (!doc || depth > 3 || result.includes(doc)) return;
result.push(doc);
for (const frame of doc.querySelectorAll('iframe')) {
try { visit(frame.contentDocument, depth + 1); } catch (_) { /* cross origin */ }
}
};
visit(document, 0);
return result;
}

function quizCompleted() {
if(app._currentStepTitle()!=='章节测验') return false;
return courseDocuments().some(doc=>{
const text=clean(doc.body?.innerText);
return /本次成绩\s*\d+(?:\.\d+)?\s*分/.test(text) &&
(/章节测验\s*已完成/.test(text)||/我的答案\s*[:：]/.test(text));
});
}
function optionElements(card) {
const labels = Array.from(card.querySelectorAll('span,div,label,li,p,b,i,strong,a'))
.filter((el) => /^[A-H]$/.test(clean(el.textContent)) &&
!Array.from(el.children).some((child) => /^[A-H]$/.test(clean(child.textContent))));
const found = new Map();
for (const label of labels) {
const letter = clean(label.textContent);
if (found.has(letter)) continue;
let target = label;
for (let n = 0; n < 5; n++) {
const parent = target.parentElement;
if (!parent || parent === card) break;
const otherLetters = Array.from(parent.querySelectorAll('span,div,label,li,p,b,i,strong,a'))
.filter((el) => /^[A-H]$/.test(clean(el.textContent)) && el !== label);
if (otherLetters.some((el) => !el.contains(label) && !label.contains(el))) break;
target = parent;
if (clean(target.innerText).length > 1) break;
}
const text = clean(target.innerText).replace(new RegExp(`^${letter}[.、．]?\\s*`), '');
if (text) found.set(letter, { letter, text, element: target });
}
return Array.from(found.values()).sort((a, b) => a.letter.localeCompare(b.letter));
}

function extractQuestions() {
const questions = [];
for (const doc of courseDocuments()) {
const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
const seenCards = new Set();
let node;
while ((node = walker.nextNode())) {
const kind = clean(node.textContent).match(kindPattern)?.[1];
if (!kind || !visible(node.parentElement)) continue;
let card = node.parentElement;
let options = [];
for (let depth = 0; card && depth < 9; depth++, card = card.parentElement) {
const cardText = clean(card.innerText);
const kinds = cardText.match(new RegExp(kindPattern.source, 'g')) || [];
if (kinds.length > 1) break;
options = optionElements(card);
if (options.length >= 2 && options.length <= 8) break;
}
if (!card || options.length < 2 || options.length > 8 || seenCards.has(card)) continue;
seenCards.add(card);
const full = card.innerText || '';
const firstOption = full.search(/(?:^|\n)\s*A\s*(?:[.、．]|\S)/);
const title = clean(firstOption >= 0 ? full.slice(0, firstOption) :
(node.parentElement.innerText || full))
.replace(/^\d+\s*/, '').replace(kindPattern, '').trim();
if (!title || title.length > 500 || options.some((option) => !option.text || option.text.length > 500)) continue;
questions.push({ kind, title, options, card, doc });
}
}
return questions;
}

function findButton(doc, label) {
const candidates = Array.from(doc.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"],div,span'))
.filter((el) => visible(el) && clean(el.value || el.innerText) === label);
return candidates.find((el) => /^(BUTTON|A|INPUT)$/.test(el.tagName)) ||
candidates.find((el) => !Array.from(el.children).some((child) => clean(child.innerText) === label)) || null;
}

function findNextButton() {
for (const doc of courseDocuments()) {
const known = doc.querySelector('#prevNextFocusNext, #right1, .nextChapter');
if (visible(known) && clean(known.innerText || known.title).includes('下一节')) return known;
const generic = findButton(doc, '下一节');
if (generic) return generic;
}
return null;
}

async function revealQuizQuestions() {
const docs = courseDocuments();
const submit = docs.map((doc) => findButton(doc, '提交')).find(Boolean);
if (!submit) return;
let scroller = submit.parentElement;
while (scroller && scroller !== submit.ownerDocument.body) {
const style = scroller.ownerDocument.defaultView.getComputedStyle(scroller);
if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 100) break;
scroller = scroller.parentElement;
}
if (!scroller || scroller === submit.ownerDocument.body) {
scroller = submit.ownerDocument.scrollingElement;
}
if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 100) return;
scroller.scrollTop = 0;
await sleep(150);
for (let step = 0; step < 50; step++) {
const bottom = scroller.scrollHeight - scroller.clientHeight;
if (scroller.scrollTop >= bottom - 2) break;
scroller.scrollTop = Math.min(bottom, scroller.scrollTop + Math.max(300, scroller.clientHeight * 0.75));
await sleep(120);
}
}

async function waitForQuizQuestions() {
let submitDoc = null;
for (let attempt = 0; attempt < 240; attempt++) {
if (stopped) throw new Error('脚本已停止');
if (quizCompleted()) return null;
submitDoc = courseDocuments().find((doc) => findButton(doc, '提交'));
if (submitDoc) break;
if (attempt > 0 && attempt % 30 === 0) console.log(`测验提交按钮仍在加载，已等待 ${attempt / 2} 秒`);
await sleep(500);
}
if (!submitDoc) throw new Error('进入章节测验后等待 120 秒，仍未找到“提交”按钮。请检查题目框架是否正常加载');

await revealQuizQuestions();
let previousSignature = '';
let stableCount = 0;
for (let attempt = 0; attempt < 240; attempt++) {
if (stopped) throw new Error('脚本已停止');
if (quizCompleted()) return null;
const questions = extractQuestions();
const countText = clean(submitDoc.body.innerText).match(/题量\s*[:：]\s*(\d+)/);
const expected = countText ? Number(countText[1]) : null;
if (questions.length && (!expected || questions.length === expected)) {
const signature = questions.map((q) => `${q.kind}:${q.title}:${q.options.length}`).join('|');
stableCount = signature === previousSignature ? stableCount + 1 : 0;
previousSignature = signature;
if (stableCount >= 3) return questions;
} else {
stableCount = 0;
previousSignature = '';
}
if (attempt > 0 && attempt % 30 === 0) console.log(`测验题目仍在加载，已等待 ${attempt / 2} 秒；当前识别 ${questions.length} 道`);
await sleep(500);
}
throw new Error('测验框架已打开，但等待 120 秒仍未识别完整题目。可运行 app.inspectQuiz() 查看当前识别结果');
}

async function renderQuizImages(questions) {
    const images = [];
    for (let index = 0; index < questions.length; index++) {
        const q = questions[index], doc = q.doc;
        await doc.fonts.ready;
        const runs = [];
        function walk(node) {
            if (node.nodeType === 3) {
                const text = node.textContent.replace(/\s+/g, ' ');
                if (!text.trim()) return;
                const style = doc.defaultView.getComputedStyle(node.parentElement);
                runs.push({text, font: `28px ${style.fontFamily}`});
                return;
            }
            if (node.nodeType !== 1 || /^(SCRIPT|STYLE|INPUT|BUTTON)$/.test(node.tagName)) return;
            const style = doc.defaultView.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            if (/^(IMG|SVG|MATH|CANVAS)$/i.test(node.tagName))
                throw new Error('题目含图片，需要人工检查；本次未提交');
            const block = node.tagName === 'BR' || /^(DIV|P|LI|UL|OL|H\d)$/.test(node.tagName);
            if (block) runs.push({newline: true});
            for (const child of node.childNodes) walk(child);
            if (block) runs.push({newline: true});
        }
        walk(q.card);
        if (runs.some(r => r.font?.includes('font-cxsecret'))) {
            const secretReady=()=>Array.from(doc.fonts).some(f=>f.family.replace(/["']/g,'')==='font-cxsecret'&&f.status==='loaded');
            if(!secretReady()) await doc.fonts.load('28px "font-cxsecret"');
            if(!secretReady()) throw new Error('题目字体未加载成功，本次未提交，请刷新章节后重试');
        }
        const canvas = doc.createElement('canvas');
        canvas.width = 1400;
        const measure = canvas.getContext('2d');
        const commands = [];
        let x = 36, y = 88, lineHasText = false;
        for (const run of runs) {
            if (run.newline) {
                if (lineHasText) { y += 44; x = 36; lineHasText = false; }
                continue;
            }
            measure.font = run.font;
            for (const char of run.text) {
                const width = measure.measureText(char).width;
                if (x + width > 1364) { x = 36; y += 44; }
                commands.push({char, x, y, font: run.font});
                x += width;
                lineHasText = true;
            }
        }
        canvas.height = Math.ceil(y + 60);
        if (canvas.height > 6000) throw new Error('题目图片过长，需要人工检查');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#111'; ctx.textBaseline = 'top'; ctx.font = 'bold 30px sans-serif';
        ctx.fillText(`QUESTION ${index + 1} / ${questions.length} - ${q.kind}`, 36, 24);
        for (const command of commands) {
            ctx.font = command.font;
            ctx.fillText(command.char, command.x, command.y);
        }
        images.push(canvas.toDataURL('image/png'));
    }
    return images;
}

async function askCodex(questions) {
setStatus('正在识别并回答 ' + questions.length + ' 道章节测验题');
const payload = questions.map((q,i)=>({ id:i+1, type:q.kind, question:q.title, options:q.options.map(o=>({letter:o.letter,text:o.text})) }));
const images = await renderQuizImages(questions);
const data = await bridgeRequest('/answer', {questions:payload, images});
if(stopped) throw new Error('脚本已停止');
return data.answers;
}
function validateAnswers(questions, answers) {
if (!Array.isArray(answers) || answers.length !== questions.length) throw new Error('AI 返回的题目数量不匹配');
const result = new Map();
for (const item of answers) {
if (!Number.isInteger(item.id) || result.has(item.id) || !Array.isArray(item.letters))
throw new Error('AI 答案格式错误');
if(item.confidence !== 'high') throw new Error(`第 ${item.id} 题识别或答案不确定，本次未提交`);
const q = questions[item.id - 1];
if (!q) throw new Error('AI 返回未知题号');
const letters = item.letters.map((letter) => clean(letter).toUpperCase());
if (!letters.length) throw new Error(`第 ${item.id} 题 AI 未给出选项，已停止提交`);
if (new Set(letters).size !== letters.length) throw new Error(`第 ${item.id} 题答案包含重复选项，已停止提交`);
if (q.kind !== '多选题' && letters.length !== 1)
throw new Error(`第 ${item.id} 题是${q.kind}，但 AI 返回了 ${letters.length} 个选项，已停止提交`);
const invalidLetters = letters.filter((letter) => !q.options.some((option) => option.letter === letter));
if (invalidLetters.length)
throw new Error(`第 ${item.id} 题 AI 返回了页面中不存在的选项：${invalidLetters.join('、')}，已停止提交`);
result.set(item.id, letters);
}
return result;
}

function selectedLetters(q) {
const hidden = Array.from(q.card.querySelectorAll('input[type="hidden"]')).find(e=>/^answer\d+$/.test(e.name));
if(hidden) {
const value=hidden.value.toLowerCase();
if(value==='true'||value==='false') return q.options.filter(o=>o.element.querySelector('[data]')?.getAttribute('data')?.toLowerCase()===value).map(o=>o.letter).sort();
return [...hidden.value.toUpperCase()].filter(c=>/[A-H]/.test(c)).sort();
}
return q.options.filter(o=>o.element.querySelector('input:checked') || o.element.getAttribute('aria-checked') === 'true').map(o=>o.letter).sort();
}
async function selectAnswers(questions, answers) {
for(let i=0;i<questions.length;i++) {
const q=questions[i], desired=answers.get(i+1);
if(stopped || !q.card.isConnected || !courseDocuments().includes(q.doc)) throw new Error('页面已变化或脚本停止');
const before=selectedLetters(q);
if(q.kind==='多选题') for(const letter of before.filter(c=>!desired.includes(c))) { q.options.find(o=>o.letter===letter).element.click(); await sleep(100); }
for(const letter of desired) {
if(!selectedLetters(q).includes(letter)) { const option=q.options.find(o=>o.letter===letter); option.element.scrollIntoView({block:'center'}); option.element.click(); await sleep(150); }
}
if(selectedLetters(q).join('') !== [...desired].sort().join('')) throw new Error(`第 ${i+1} 题未确认准确选中，本次未提交`);
}
}
function stepIdentity() { const u=new URL(location.href); return ['courseId','clazzid','chapterId'].map(k=>u.searchParams.get(k)||'').join(':')+'|'+clean(document.querySelector('.prev_title')?.innerText); }
function questionKeys(questions) {
const ids=questions.map(q=>q.card.querySelector('[qid]')?.getAttribute('qid') || q.card.closest('.singleQuesId[id]')?.id);
if(ids.some(id=>!id)||new Set(ids).size!==ids.length) throw new Error('题目缺少稳定标识，本次未提交');
return ids.join(',');
}
function assertChapterOnly(doc) {
if(app._currentStepTitle() !== '章节测验' || !clean(doc.body.innerText).includes('章节测验') ||
/考试剩余时间|期末考试|期中考试|正式考试|限时考试|剩余时间/.test(clean(doc.body.innerText))) throw new Error('当前不是普通章节测验，已停止');
}
async function confirmSubmitDialog() {
for (let i = 0; i < 20; i++) {
if (stopped) throw new Error('脚本已停止');
const dialogs = courseDocuments().flatMap((doc) =>
Array.from(doc.querySelectorAll('#popok,[role="dialog"],[role="alertdialog"],.layui-layer-dialog,.el-message-box,.modal')));
const platformButton = dialogs.find((el) => el.id === 'popok' && visible(el));
if (platformButton) {
const message = clean(platformButton.ownerDocument.querySelector('#popcontent')?.innerText);
if (/未作答|请选择|请作答|答完/.test(message) || !/提交|交卷/.test(message))
throw new Error(`平台拒绝提交：${message}`);
console.log(`确认平台提交窗口：${message || '提交'}`);
platformButton.click();
return;
}
const dialog = dialogs.find((el) => el.id !== 'popok' && visible(el) && /提交|交卷/.test(clean(el.innerText)));
if (dialog) {
const confirm = findButton(dialog, '确定') || findButton(dialog, '确认') || findButton(dialog, '提交');
if (!confirm) throw new Error('提交确认窗口未找到确认按钮');
confirm.click();
return;
}
await sleep(250);
}
}

async function submitQuiz(doc) {
if (stopped) throw new Error('脚本已停止');
const submit = findButton(doc, '提交');
if (!submit) throw new Error('未找到测验提交按钮');
submit.scrollIntoView({ block: 'center' });
console.log('选项已选择，点击章节测验的提交按钮');
submit.click();
await confirmSubmitDialog();
console.log('提交已确认，等待学习通生成成绩或任务完成标记；确认后再点击“下一节”');
let elapsedHalfSeconds = 0;
while (!stopped && elapsedHalfSeconds < 240) {
await sleep(500);
elapsedHalfSeconds++;
if (quizCompleted()) return;
if (elapsedHalfSeconds % 30 === 0) console.log(`成绩页仍在加载，已等待 ${elapsedHalfSeconds / 2} 秒`);
}
throw new Error('提交结果未在120秒内确认，请人工检查，禁止重复提交');
}

async function goToNextStep() {
if (stopped) throw new Error('脚本已停止');
const next = findNextButton();
if (!next) throw new Error('未找到页面下方的“下一节”按钮');
app._nextUnitPending = true;
const previousStep = app._currentStepTitle();
const previousIdentity = stepIdentity();
app._clearCheckInterval();
app._videoEl = null;
app._isPlaying = false;
next.scrollIntoView({ block: 'center' });
console.log(`${previousStep || '当前学习步骤'}完成，点击页面“下一节”，等待新内容加载`);
next.click();
let currentStep = '';
let stepReady = false;
for (let attempt = 0; attempt < 240; attempt++) {
if (stopped) throw new Error('脚本已停止');
await sleep(500);
currentStep = app._currentStepTitle();
if (currentStep !== previousStep && currentStep === '章节测验') {
stepReady = true;
break;
}
if ((currentStep !== previousStep || stepIdentity() !== previousIdentity) && currentStep === '视频') {
app._videoEl = null;
if (app._getVideoEl()) {
stepReady = true;
break;
}
}
if (attempt > 0 && attempt % 30 === 0) console.log(`下一学习步骤仍在加载，已等待 ${attempt / 2} 秒；当前页签：${currentStep || '未显示'}`);
}
if (!stepReady) {
throw new Error(`点击“下一节”后等待 120 秒，新学习步骤仍未加载完成；当前页签：${currentStep || '未显示'}`);
}
app._nextUnitPending = false;
app._videoEl = null;
app._initCellData();
if(app._currentStepTitle()==='视频') setStatus('播放中：'+app.cellData.currentVideoTitle);
app.play();
}

app.nextUnit = function () {
if (stopped || this._nextUnitPending) return;
this._nextUnitPending = true;
goToNextStep().catch((error) => {
this._nextUnitPending = false;
console.error('切换下一学习步骤失败:', error);
});
};

app.inspectQuiz = function () {
return extractQuestions().map((q, i) => ({
id: i + 1, type: q.kind, question: q.title,
options: q.options.map((o) => `${o.letter}. ${o.text}`),
}));
};

app._advanceChapterTest = function () {
if (stopped || quizBusy) return;
quizBusy = true;
(async () => {
if (quizCompleted()) {
console.log('检测到当前章节测验已完成，点击“下一节”进入新视频');
await goToNextStep();
return;
}
console.log('已进入章节测验，等待题目和提交按钮加载');
const questions = await waitForQuizQuestions();
if (questions === null) {
console.log('检测到当前章节测验已完成，点击“下一节”进入新视频');
await goToNextStep();
return;
}
if (questions.length > 30) throw new Error('题目数量超过 30，已停止自动提交');
const docs = new Set(questions.map((q) => q.doc));
if (docs.size !== 1) throw new Error('题目跨多个框架，已停止自动提交');
const countText = clean(questions[0].doc.body.innerText).match(/题量\s*[:：]\s*(\d+)/);
if (countText && Number(countText[1]) !== questions.length)
throw new Error(`页面显示 ${countText[1]} 道题，脚本只识别 ${questions.length} 道，已停止提交`);
assertChapterOnly(questions[0].doc);
const identity=stepIdentity();
const signature=identity+'|'+questionKeys(questions);
const journal='codexQuiz:'+signature;
if(sessionStorage.getItem(journal)==='submitting') throw new Error('上次提交结果未确认，请人工检查，本次不重复提交');
if (attemptedQuizzes.has(signature)) throw new Error('本次测验已尝试过，已停止重复提交');
console.log(`识别到 ${questions.length} 道题，正在调用 Codex`);
const answers = validateAnswers(questions, await askCodex(questions));
if(stopped || identity!==stepIdentity() || questions.some(q=>!q.card.isConnected || !courseDocuments().includes(q.doc))) throw new Error('等待期间章节已变化，本次不提交');
assertChapterOnly(questions[0].doc);
console.table(questions.map((q, i) => ({ 题号: i + 1, 题型: q.kind, 选择: answers.get(i + 1).join('') })));
await selectAnswers(questions, answers);
if(stopped || identity!==stepIdentity() || questions.some((q,i)=>!courseDocuments().includes(q.doc) || selectedLetters(q).join('')!==[...answers.get(i+1)].sort().join(''))) throw new Error('提交前页面或选项已变化，本次未提交');
assertChapterOnly(questions[0].doc);
attemptedQuizzes.add(signature);
sessionStorage.setItem(journal,'submitting');
setStatus('正在提交章节测验');
await submitQuiz(questions[0].doc);
sessionStorage.setItem(journal,'complete');
app.lastQuizResult={chapter:app.cellData.currentVideoTitle,score:courseDocuments().map(d=>clean(d.body?.innerText)).join(' ').match(/本次成绩\s*(\d+(?:\.\d+)?)/)?.[1] || null};
await bridgeRequest('/event',{kind:'quiz_completed',...app.lastQuizResult},5000).catch(()=>{});
setStatus('章节测验已完成，继续下一节');
console.log('章节测验提交已确认，点击“下一节”进入新视频');
quizBusy = false;
await goToNextStep();
})().catch((error) => {
app._nextUnitPending = false;
setStatus(error.message);
stopped=true; originalDestroy();
console.error('章节测验自动作答停止:', error);
})
.finally(() => { quizBusy = false; });
};

}
function initializePlayer() {
const app = {
configs: {
autoplay: true,
retryInterval: 2000,
maxRetries: 10,
videoCheckInterval: 1000,
guardNoProgressMs: 7000,
guardResumeCooldownMs: 1500,
autoAdvanceNoVideo: false,
},
_videoEl: null,
_treeContainerEl: null,
_isPlaying: false,
_currentRetryCount: 0,
_checkInterval: null,
_eventVideoEl: null,
_boundVideoHandlers: null,
_nextUnitPending: false,
_chapterAdvanceTimes: 0,
_cellData: {
cells: 0,
nCells: 0,
currentCellIndex: 0,
currentNCellIndex: 0,
currentVideoTitle: "",
},
get cellData() {
return this._cellData;
},
run() {
console.log("%c=== 学习通视频与章节测验助手 V4 启动 ===", "color:#4CAF50;font-size:16px;font-weight:bold");
this._nextUnitPending = false;
this._chapterAdvanceTimes = 0;
this._getTreeContainer();
this._initCellData();
console.log(`当前学习步骤：${this._currentStepTitle() || '等待页面加载'}`);
this._videoEl = null;
this._getVideoEl();
this._clearCheckInterval();
this._bindStepNavigation();
this.play();
},
nextUnit() {
if (this._nextUnitPending) {
console.warn('%c已有小节切换正在进行，忽略重复请求', 'color:#FF9800');
return;
}
this._nextUnitPending = true;
this._clearCheckInterval();
console.log("%c=== 准备切换到下一小节 ===", "color:#2196F3;font-size:14px");
try {
const el = this._getTreeContainer();
const cells = el.children("ul").children("li");
const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
if (nCells.length > this._cellData.currentNCellIndex + 1) {
const nextNIndex = this._cellData.currentNCellIndex + 1;
console.log(`%c切换到同章节下一个视频: ${nextNIndex + 1}/${nCells.length}`, "color:#FF9800");
this.playCurrentIndex(nCells.get(nextNIndex));
} else {
const nextIndex = this._cellData.currentCellIndex + 1;
if (nextIndex >= cells.length) {
console.log("%c=====================================", "color:#4CAF50;font-size:16px");
console.log("%c==============本课程学习完成了==============", "color:#4CAF50;font-size:16px;font-weight:bold");
console.log("%c=====================================", "color:#4CAF50;font-size:16px");
return;
}
console.log(`%c切换到下一个章节: ${nextIndex + 1}/${cells.length}`, "color:#FF9800");
this._cellData.currentCellIndex = nextIndex;
this._cellData.currentNCellIndex = 0;
this.playCurrentIndex();
}
} catch (error) {
this._nextUnitPending = false;
console.error('切换下一小节失败:', error);
}
},
_clearCheckInterval() {
if (this._checkInterval) {
clearInterval(this._checkInterval);
this._checkInterval = null;
}
},
_startVideoMonitoring() {
this._clearCheckInterval();
this._guardLastTime = 0;
this._guardLastWallTs = 0;
this._guardLastResumeTs = 0;
this._checkInterval = setInterval(() => {
this._checkVideoStatus();
}, this.configs.videoCheckInterval);
},
_tryResumePlayback(reason) {
const now = Date.now();
if (now - this._guardLastResumeTs < this.configs.guardResumeCooldownMs) {
return;
}
this._guardLastResumeTs = now;
const video = this._getVideoEl();
if (!video || !this._isPlaying) return;
video.muted = true;
video.defaultMuted = true;
video.volume = 0;
console.log(`%c触发视频保活恢复(${reason})`, "color:#607D8B");
video.play().catch((e) => {
console.warn("直接恢复播放失败，尝试静音恢复:", e);
video.muted = true;
video.play().catch((err) => {
console.error("静音恢复播放失败:", err);
});
});
},
_checkVideoStatus() {
try {
if(this._isChapterTest()) {this._isPlaying=false;this._clearCheckInterval();this._advanceChapterTest();return;}
const video = this._getVideoEl();
if (!video) return;
if (video !== this._eventVideoEl) { this._initCellData(); this.play(); return; }
video.muted = true;
video.defaultMuted = true;
video.volume = 0;
if (video.paused && this._isPlaying) {
console.log("%c检测到视频暂停，尝试恢复播放...", "color:#FF5722");
this._tryResumePlayback("paused");
} else if (this._isPlaying && !video.ended) {
const now = Date.now();
const current = Number(video.currentTime || 0);
if (this._guardLastWallTs === 0) {
this._guardLastWallTs = now;
this._guardLastTime = current;
} else {
const stalled = Math.abs(current - this._guardLastTime) < 0.01;
const stalledMs = now - this._guardLastWallTs;
if (stalled && stalledMs >= this.configs.guardNoProgressMs) {
this._tryResumePlayback("no-progress");
this._guardLastWallTs = now;
this._guardLastTime = Number(video.currentTime || 0);
} else if (!stalled) {
this._guardLastWallTs = now;
this._guardLastTime = current;
}
}
}
if (video.ended && this._isPlaying) {
console.log("%c检测到视频结束，准备切换下一个...", "color:#9C27B0");
this._isPlaying = false;
setTimeout(() => this.nextUnit(), 1000);
}
} catch (e) {
console.error("视频状态检查失败:", e);
}
},
_tryTimes: 0,
_stepAdvanceTimes: 0,
_stepSwitchAt: 0,
_stepSwitchPending: false,
_delayedNextUnitTimer: null,
_guardLastTime: 0,
_guardLastWallTs: 0,
_guardLastResumeTs: 0,
async play() {
try {
if(stoppedByUser()) return;
if (this._isChapterTest()) {
this._videoEl = null;
this._isPlaying = false;
this._clearCheckInterval();
this._advanceChapterTest();
return;
}
const el = this._getVideoEl();
if (el == null) {
if (this._currentStepTitle() === '视频') {
throw new Error('视频组件尚未加载完成');
}
if (this._advanceLearningStep()) {
console.log("%c当前不在视频页，已尝试切到下一学习步骤，2秒后重试", "color:#607D8B");
setTimeout(() => {
this.play();
}, 2000);
return;
}
if (this._isChapterTest()) {
this._advanceChapterTest();
return;
}
this._isPlaying = false;
this._clearCheckInterval();
if (this.configs.autoAdvanceNoVideo) {
console.warn('%c当前小节未发现视频，按配置切换到下一小节', 'color:#FF9800');
this.nextUnit();
} else {
console.warn('%c当前小节未发现视频或可识别的学习步骤，已安全停止。确认无需完成课件后，可执行 app.nextUnit()。', 'color:#FF9800');
}
return;
}
this._isPlaying = true;
this._videoEventHandle();
try {
el.muted = true;
el.defaultMuted = true;
el.volume = 0;
await el.play();
this._tryTimes = 0;
console.log('%c视频开始播放，保持页面默认播放速度', 'color:#4CAF50');
this._startVideoMonitoring();
} catch (playError) {
console.error("视频播放失败:", playError);
this._handlePlayError(playError);
}
} catch (e) {
if (this._tryTimes >= this.configs.maxRetries) {
console.error("%c视频播放失败，已达到最大重试次数", "color:#F44336;font-weight:bold", e);
this._clearCheckInterval();
return;
}
this._tryTimes++;
console.log(`%c播放失败，${this.configs.retryInterval/1000}秒后重试 (${this._tryTimes}/${this.configs.maxRetries})`, "color:#FF9800");
setTimeout(() => {
this.play();
}, this.configs.retryInterval);
}
},
_advanceLearningStep() {
if (this._stepSwitchPending && Date.now() - this._stepSwitchAt < 4000) {
return true;
}
const currentStepTitle = this._currentStepTitle();

if (currentStepTitle === "章节测验" || currentStepTitle === "视频") {
return false;
}
const clickElement = (el, label) => {
if (!el) return false;
this._stepSwitchPending = true;
this._stepSwitchAt = Date.now();
console.log(`%c尝试点击${label}`, "color:#2196F3");
el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
return true;
};
const videoTab = $(".prev_white:visible").filter((_, el) => {
const text = ($(el).text() || "").replace(/\s+/g, "");
return text === "2视频" || text === "视频";
}).get(0);
if (clickElement(videoTab, "“视频”页签")) {
return true;
}
return false;
},
_currentStepTitle() {
const cardsFrame = Array.from(document.querySelectorAll('iframe[src*="/knowledge/cards"]'))
.find((frame) => frame.getClientRects().length > 0);
if (cardsFrame) {
const num = new URL(cardsFrame.getAttribute('src'), location.href).searchParams.get('num');
if (num === '0') return '视频';
if (num === '1') return '章节测验';
}
const prevTitle = document.getElementsByClassName('prev_title')[0];
const text = prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';
return text === '视频' || text === '章节测验' ? text : '';
},
_isChapterTest() {
return this._currentStepTitle() === '章节测验';
},
_advanceChapterTest() {
if (this._chapterAdvanceTimes >= 3) {
console.error('%c章节测验页面连续跳转失败，已停止以避免页面循环。请手动处理后执行 app.run()。', 'color:#F44336;font-weight:bold');
return;
}
const nextButton = $('#prevNextFocusNext:visible, #right1:visible, .nextChapter:visible').first().get(0);
if (!nextButton) {
console.warn('%c未找到章节测验的下一步按钮，已停止。', 'color:#FF9800');
return;
}
this._chapterAdvanceTimes++;
console.log('%c检测到章节测验，尝试进入下一学习步骤', 'color:#607D8B');
nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
setTimeout(() => this.play(), 2000);
},
_bindStepNavigation() {
if (this._stepNavigationBound) {
return;
}
this._stepNavigationBound = true;
const reenterVideoMode = () => {
this._videoEl = null;
this._isPlaying = false;
this._stepSwitchPending = true;
this._stepSwitchAt = Date.now();
setTimeout(() => {
try {
this._initCellData();
} catch (e) {}
this.play();
}, 1800);
};
$(document).off('click.xuexitongPlayerV4', '.prev_white').on('click.xuexitongPlayerV4', '.prev_white', (e) => {
const text = ($(e.currentTarget).text() || "").replace(/\s+/g, "");
if (text.includes("视频") || text.includes("章节测验")) {
console.log(`%c检测到步骤切换点击：${text}，准备重新识别页面`, "color:#607D8B");
reenterVideoMode();
}
});
},
_handlePlayError(error) {
console.error("播放错误详情:", error);
const video = this._getVideoEl();
if (video) {
video.muted = true;
video.play().then(() => {
console.log("%c静音播放成功", "color:#4CAF50");
this._tryTimes = 0;
this._startVideoMonitoring();
if (this._delayedNextUnitTimer) {
clearTimeout(this._delayedNextUnitTimer);
this._delayedNextUnitTimer = null;
}
}).catch(e => {
console.error("静音播放也失败:", e);
if (this._delayedNextUnitTimer) {
clearTimeout(this._delayedNextUnitTimer);
}
this._isPlaying = false;
if (this._tryTimes >= this.configs.maxRetries) {
console.error('%c静音播放失败，已达到最大重试次数', 'color:#F44336;font-weight:bold', e);
return;
}
this._tryTimes++;
this._delayedNextUnitTimer = setTimeout(() => {
this._delayedNextUnitTimer = null;
this.play();
}, this.configs.retryInterval);
});
}
},
playCurrentIndex(nCell) {
this._nextUnitPending = false;
if (!nCell) {
const el = this._getTreeContainer();
const cells = el.children("ul").children("li");
const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
nCell = nCells.get(this._cellData.currentNCellIndex);
}
const $nCell = $(nCell);
const clickableSpan = $nCell.find(".posCatalog_name")[0];
if (!clickableSpan) {
console.error("%c===========找不到可点击的课程节点，播放下一个视频失败==============", "color:#F44336");
return;
}
console.log(`%c点击切换到: ${$(clickableSpan).attr('title') || '未知标题'}`, "color:#2196F3");
$(clickableSpan).click();
this._videoEl = null;
this._isPlaying = false;
console.log("%c等待视频加载...", "color:#FF9800");
setTimeout(() => {
this._initCellData();
if (this.configs.autoplay) {
this.play();
}
}, 3000);
},
_initCellData() {
const el = this._getTreeContainer();
const cells = el.children("ul").children("li");
this._cellData.cells = cells.length;
let nCellCounts = 0;
let foundCurrent = false;
cells.each((i, v) => {
const nCells = $(v).find('.posCatalog_select:not(.firstLayer)');
nCellCounts += nCells.length;
nCells.each((j, e) => {
const _el = $(e);
if (_el.hasClass("posCatalog_active")) {
this._cellData.currentCellIndex = i;
this._cellData.currentNCellIndex = j;
foundCurrent = true;
const titleSpan = _el.find('.posCatalog_name')[0];
if (titleSpan) {
this._cellData.currentVideoTitle = $(titleSpan).attr('title');
}
}
});
});
this._cellData.nCells = nCellCounts;

if (!foundCurrent && nCellCounts > 0) {
console.warn("%c未找到当前激活的视频节点，可能需要手动选择", "color:#FF9800");
}
console.log(`%c课程信息: ${this._cellData.cells}章, ${this._cellData.nCells}节, 当前: 第${this._cellData.currentCellIndex + 1}章第${this._cellData.currentNCellIndex + 1}节`, "color:#607D8B");
},
_getTreeContainer() {
if (!this._treeContainerEl) {
const el = $('#coursetree');
if (el.length <= 0) {
throw new Error("找不到视频列表");
}
this._treeContainerEl = el;
}
return this._treeContainerEl;
},
            _isCurrentVideo(video) {
                try {
                    if (!video || !video.isConnected || video.error) return false;
                    const visible = (element) => {
                        if (!element.getClientRects().length) return false;
                        const style = element.ownerDocument.defaultView.getComputedStyle(element);
                        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
                    };
                    if (!visible(video)) return false;
                    let owner = video.ownerDocument;
                    while (owner?.defaultView && owner.defaultView !== window) {
                        const view = owner.defaultView;
                        // isConnected can stay true in an iframe's discarded document.
                        if (view.document !== owner) return false;
                        const frame = view.frameElement;
                        if (!frame || !frame.isConnected || !visible(frame)) return false;
                        owner = frame.ownerDocument;
                    }
                    return owner === document;
                } catch (error) {
                    return false;
                }
            },
            _getVideoEl() {
                const candidates = new Set();
                const scan = (owner, depth) => {
                    if (!owner || depth > 4) return;
                    for (const video of owner.querySelectorAll('video#video_html5_api, video[id*="video_html5"]')) {
                        if (this._isCurrentVideo(video)) candidates.add(video);
                    }
                    for (const frame of owner.querySelectorAll('iframe')) {
                        try {
                            scan(frame.contentDocument || frame.contentWindow?.document, depth + 1);
                        } catch (error) {
                            // Unrelated cross-origin frames must not abort the player search.
                            if (error?.name !== 'SecurityError') console.warn('读取视频框架失败:', error);
                        }
                    }
                };
                scan(document, 0);
                // Some pages retain an empty video beside the loaded lesson player.
                const score = (video) => Number(video.readyState || 0) * 10 +
                    (Number.isFinite(video.duration) && video.duration > 0 ? 2 : 0) +
                    (!video.paused ? 1 : 0);
                this._videoEl = [...candidates].sort((a, b) => score(b) - score(a))[0] || null;
                return this._videoEl;
            },
_videoEventHandle() {
const el = this._videoEl;
if (!el) {
console.log("videoEl未加载");
return;
}
if (this._eventVideoEl === el) return;
this._detachVideoEvents();
this._eventVideoEl = el;
this._boundVideoHandlers = {
ended: this._handleVideoEnded.bind(this),
loadedmetadata: this._handleVideoLoaded.bind(this),
play: this._handleVideoPlay.bind(this),
pause: this._handleVideoPause.bind(this),
};
el.addEventListener('ended', this._boundVideoHandlers.ended);
el.addEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
el.addEventListener('play', this._boundVideoHandlers.play);
el.addEventListener('pause', this._boundVideoHandlers.pause);
},
_detachVideoEvents() {
if (!this._eventVideoEl || !this._boundVideoHandlers) return;
this._eventVideoEl.removeEventListener('ended', this._boundVideoHandlers.ended);
this._eventVideoEl.removeEventListener('loadedmetadata', this._boundVideoHandlers.loadedmetadata);
this._eventVideoEl.removeEventListener('play', this._boundVideoHandlers.play);
this._eventVideoEl.removeEventListener('pause', this._boundVideoHandlers.pause);
this._eventVideoEl = null;
this._boundVideoHandlers = null;
},
_handleVideoEnded(e) {
if(e?.target && e.target !== this._getVideoEl()) return;
const title = this._cellData.currentVideoTitle;
console.warn(`%c============'${title}' 播放完成=============`, "color:#4CAF50;font-weight:bold");
this._isPlaying = false;
this._clearCheckInterval();
setTimeout(() => this.nextUnit(), 1000);
},
_handleVideoLoaded(e) {
if(e?.target && e.target !== this._getVideoEl()) return;
console.log(`%c============视频加载完成=============`, "color:#2196F3");
if (this.configs.autoplay && !this._isPlaying) {
this.play();
}
},
_handleVideoPlay(e) {
if(e?.target && e.target !== this._getVideoEl()) return;
const title = this._cellData.currentVideoTitle;
console.info(`%c============'${title}' 开始播放=============`, "color:#4CAF50");
this._isPlaying = true;
this._stepSwitchPending = false;
const video = this._getVideoEl();
this._guardLastTime = Number(video?.currentTime || 0);
this._guardLastWallTs = Date.now();
if (this._delayedNextUnitTimer) {
clearTimeout(this._delayedNextUnitTimer);
this._delayedNextUnitTimer = null;
}
},
_handleVideoPause(e) {
if(e?.target && e.target !== this._getVideoEl()) return;
console.log(`%c============视频暂停=============`, "color:#FF9800");
},
_bindPageGuards() {
const preventPause = (e) => {
e.stopPropagation();
e.preventDefault();
};
const resumePlaybackNow = () => this._tryResumePlayback('page-event');
this._pageGuards = { preventPause, resumePlaybackNow };
document.addEventListener('mouseleave', preventPause);
window.addEventListener('mouseleave', preventPause);
document.addEventListener('mouseout', preventPause);
window.addEventListener('mouseout', preventPause);
window.addEventListener('blur', resumePlaybackNow);
document.addEventListener('visibilitychange', resumePlaybackNow);
},
destroy() {
this._isPlaying = false;
this._clearCheckInterval();
this._detachVideoEvents();
if (this._delayedNextUnitTimer) clearTimeout(this._delayedNextUnitTimer);
$(document).off('.xuexitongPlayerV4');
if (this._pageGuards) {
const { preventPause, resumePlaybackNow } = this._pageGuards;
document.removeEventListener('mouseleave', preventPause);
window.removeEventListener('mouseleave', preventPause);
document.removeEventListener('mouseout', preventPause);
window.removeEventListener('mouseout', preventPause);
window.removeEventListener('blur', resumePlaybackNow);
document.removeEventListener('visibilitychange', resumePlaybackNow);
this._pageGuards = null;
}
},
};
attachQuizAutomation(app);
PAGE.app = app;
PAGE[APP_KEY] = app;

try {
app.run();
setStatus(app._isChapterTest()?'正在处理章节测验':'正常播放视频');
} catch (error) {
console.error("%c脚本运行失败: ", "color:#F44336;font-weight:bold", error.message);
console.log("请检查是否在正确的课程播放页面，或者页面结构是否再次发生改变。");
}
}
})();
