import { createChiefRoster } from './chiefRoster.mjs';
import { chiefChatMarkup, chiefMessagesMarkup } from '../../components/ChiefChat.mjs';
export function createChiefChat({ host, request, getContext, onReview, onVisibility, getRosterPlugin = () => null, win = window }) {
  const doc = host.ownerDocument;
  const overlay = doc.createElement('div'); overlay.className = 'chief-overlay'; overlay.hidden = true; overlay.innerHTML = chiefChatMarkup(); host.append(overlay);
  const input = overlay.querySelector('textarea'), sendButton = overlay.querySelector('.chief-send');
  const messages = overlay.querySelector('.chief-messages'), status = overlay.querySelector('.chief-status');
  let conversation = null, pending = null, error = '', loading = false, sending = false, opened = false, generation = 0, timer, returnFocus, bodyOverflow, signature = '';
  const busy = () => sending || loading || conversation?.status === 'processing' || conversation?.status === 'resetting';
  const locked = () => busy() || conversation?.status === 'blocked';
  const roster = createChiefRoster({ overlay, win, getPlugin: getRosterPlugin, isLocked: locked, isVisible: () => opened && doc.visibilityState !== 'hidden', onOperation: async body => {
    const epoch=generation;
    const result=await request('/api/chief/attachments',{method:'POST',body:{...body,context:getContext()}});
    if(epoch!==generation)return;
    conversation=result.conversation;paint();schedule();
  }, onChange: () => { if (!sending) pending = null; paint(); } });
  function resize() {
    const viewport = win.visualViewport;
    overlay.style.setProperty('--chief-height', `${viewport?.height || win.innerHeight}px`);
    overlay.style.setProperty('--chief-top', `${viewport?.offsetTop || 0}px`);
    input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight || 24, 120)}px`;
  }
  function paint() {
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 120;
    const next = JSON.stringify([conversation?.id, conversation?.messages, conversation?.drafts, conversation?.attachments]);
    if (next !== signature) { messages.innerHTML = chiefMessagesMarkup(conversation); signature = next; if (nearBottom) messages.scrollTop = messages.scrollHeight; }
    status.replaceChildren();
    if (error || conversation?.error) {
      const p = doc.createElement('p'); p.textContent = error || conversation.error; status.append(p);
      const retry = doc.createElement('button'); retry.type = 'button';
      retry.textContent = conversation?.status === 'blocked' || conversation?.status === 'resetting' ? 'New Conversation' : 'Try again';
      retry.onclick = () => conversation?.status === 'blocked' || conversation?.status === 'resetting' ? reset() : pending ? submit() : refresh(); status.append(retry);
    } else if (busy()) {
      const p = doc.createElement('p'); p.className = 'chief-typing'; p.setAttribute('aria-label', loading ? 'Loading conversation' : 'Chief is working'); p.textContent = loading ? 'Loading conversation…' : 'Chief is working';
      for (let i=0;i<3;i++) p.append(doc.createElement('i')); status.append(p);
    }
    sendButton.disabled = locked() || roster.busy || (!input.value.trim() && !roster.value) || !conversation;
    roster.update(conversation);
    input.disabled = sending || conversation?.status === 'blocked';
    resize();
  }
  function schedule() {
    clearTimeout(timer);
    if (opened && doc.visibilityState !== 'hidden') timer = setTimeout(refresh, conversation?.status === 'processing' ? 2000 : 10000);
  }
  async function refresh() {
    if (!opened) return;
    const epoch = generation;
    try {
      const result = await request('/api/chief/conversation');
      if (epoch !== generation) return;
      if (conversation && result.id === conversation.id && result.updatedAt < conversation.updatedAt) return;
      if (conversation && result.id !== conversation.id) { pending = null; roster.clear(); }
      conversation = result;
      if (pending && result.messages.some(m => m.id === pending.messageId)) { pending = null; input.value = ''; roster.sent(); }
      error = '';
    } catch (e) { if (epoch === generation) error = e.message; }
    finally { if (epoch === generation) { loading = false; paint(); schedule(); } }
  }
  async function submit(event) {
    event?.preventDefault();
    if (locked() || roster.busy || !conversation || (!pending && !input.value.trim() && !roster.value)) return;
    const epoch = generation;
    pending ||= { messageId: win.crypto.randomUUID(), conversationId: conversation.id, text: input.value.trim(), context: getContext(), ...(roster.value ? { attachment: roster.value } : {}) };
    sending = true; error = ''; paint();
    try {
      const result = await request('/api/chief/messages', { method:'POST', body:pending });
      if (epoch !== generation) return;
      conversation = result.conversation; pending = null; input.value = ''; roster.sent(); messages.scrollTop = messages.scrollHeight;
    } catch (e) {
      if (epoch !== generation) return;
      error = e.message;
      if (e.status === 409) { pending = null; void refresh(); }
    } finally { if (epoch === generation) { sending = false; paint(); messages.scrollTop = messages.scrollHeight; schedule(); } }
  }
  async function reset() {
    if (!conversation || !win.confirm('Start a new conversation with Chief? Your current chat will be cleared on all devices. Saved calendar schedules will stay.')) return;
    const epoch = ++generation; roster.clear(); clearTimeout(timer); loading = true; error = ''; paint();
    try {
      const result = await request('/api/chief/conversation', { method:'DELETE', body:{ conversationId:conversation.id }, timeoutMs:45000 });
      if (epoch !== generation) return;
      conversation = result; pending = null; input.value = ''; signature = '';
    } catch(e) { if(epoch === generation) error = e.message; }
    finally { if(epoch === generation) { loading = false; paint(); schedule(); } }
  }
  function close() {
    if (!opened) return;
    opened = false; overlay.hidden = true; clearTimeout(timer); doc.body.style.overflow = bodyOverflow;
    onVisibility(false); returnFocus?.focus?.();
  }
  overlay.querySelector('.chief-back').onclick = close;
  overlay.querySelector('form').onsubmit = submit;
  input.oninput = () => { if (!sending) pending = null; paint(); };
  overlay.querySelector('.chief-more').onclick = event => {
    const menu = overlay.querySelector('.chief-menu'); menu.hidden = !menu.hidden; event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  };
  overlay.querySelector('.chief-new').onclick = () => { overlay.querySelector('.chief-menu').hidden = true; overlay.querySelector('.chief-more').setAttribute('aria-expanded','false'); void reset(); };
  messages.onclick = event => {
    const suggestion = event.target.closest('[data-chief-suggestion]'); if (suggestion) { input.value = suggestion.dataset.chiefSuggestion; input.focus(); paint(); }
    const review = event.target.closest('[data-chief-draft]'); if (review) {
      const draft = conversation?.drafts.find(d => d.id === review.dataset.chiefDraft);
      if (draft?.validation?.valid) { close(); onReview(structuredClone(draft)); }
    }
  };
  overlay.onkeydown = event => {
    if (event.key === 'Escape') { if(roster.reviewing) roster.closeReview(); else close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled):not([type=file])')].filter(e => !e.closest('[hidden],[inert]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  win.visualViewport?.addEventListener('resize', resize); win.visualViewport?.addEventListener('scroll', resize); win.addEventListener('resize', resize);
  doc.addEventListener('visibilitychange', () => { if (opened && doc.visibilityState !== 'hidden') void refresh(); else clearTimeout(timer); });
  return {
    open() { if (opened) return; opened = true; returnFocus = doc.activeElement; bodyOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden'; overlay.hidden = false; onVisibility(true); loading = !conversation; paint(); overlay.querySelector('.chief-back').focus(); void refresh(); },
    close,
    clear() { roster.clear(); close(); generation++; conversation = null; pending = null; input.value = ''; error = ''; sending = false; loading = false; signature = ''; messages.replaceChildren(); status.replaceChildren(); },
    get isOpen() { return opened; },
  };
}
