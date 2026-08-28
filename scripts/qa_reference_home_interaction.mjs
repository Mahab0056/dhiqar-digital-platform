const targetUrl = process.argv[2] || 'http://127.0.0.1:8799/';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes(targetUrl))
  ?? targets.find((target) => target.type === 'page');
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص تفاعل الصفحة الرئيسية.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل تقييم المتصفح.');
  return result.result.value;
};
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: targetUrl });
await delay(1200);

const categories = await evaluate(`(() => [...document.querySelectorAll('.civic-search select option')].map(option => option.value))()`);
if (!categories.includes('المحلات والأعمال')) throw new Error('تصنيف المحلات والأعمال غير ظاهر في الفلتر.');

await evaluate(`(() => document.querySelector('.civic-search input')?.focus())()`);
await send('Input.insertText', { text: 'إجازة محل' });
await delay(350);
const filtered = await evaluate(`(() => ({
  query: document.querySelector('.civic-search input')?.value || '',
  resultHref: document.querySelector('.civic-search-results a')?.getAttribute('href') || null,
  resultText: document.querySelector('.civic-search-results a strong')?.textContent?.trim() || null,
  submitDisabled: document.querySelector('.civic-search button[type="submit"]')?.disabled || false,
}))()`);
if (filtered.resultHref !== '/service/store-license' || filtered.submitDisabled) {
  throw new Error(`نتيجة بحث غير متوقعة: ${JSON.stringify(filtered)}`);
}

await evaluate(`(() => {
  const select = document.querySelector('.civic-search select');
  select.value = 'المحلات والأعمال';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);
await delay(200);
const categoryState = await evaluate(`(() => document.querySelector('.civic-search select')?.value || '')()`);
if (categoryState !== 'المحلات والأعمال') throw new Error(`تعذر تطبيق فلتر القطاع: ${categoryState}`);

await evaluate(`(() => {
  const select = document.querySelector('.civic-search select');
  select.value = 'الكل';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('form.civic-search')?.requestSubmit();
  return true;
})()`);
await delay(450);
const destination = await evaluate(`(() => ({ path: location.pathname, heading: document.querySelector('main h1')?.textContent?.trim() || '' }))()`);
if (destination.path !== '/service/store-license') {
  throw new Error(`لم يفتح البحث صفحة الخدمة المتوقعة: ${JSON.stringify(destination)}`);
}

console.log(JSON.stringify({
  home_search_interaction: 'pass',
  category: categoryState,
  query: filtered.query,
  result: filtered,
  destination,
}, null, 2));
socket.close();
