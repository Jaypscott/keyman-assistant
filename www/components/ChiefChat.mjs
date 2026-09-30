const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const chiefSparkle = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5 14.8 9.2 21.5 12l-6.7 2.8-2.8 6.7-2.8-6.7L2.5 12l6.7-2.8L12 2.5Z" fill="currentColor"/></svg>';
const chiefIcon = path => `<svg class="chief-inline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const suggestionArrow = chiefIcon('M6 18 18 6M6 6h12v12');
const reviewArrow = chiefIcon('M5 12h14m-6-6 6 6-6 6');
const validationCheck = chiefIcon('m5 12 4 4L19 6');
export function chiefChatMarkup() {
  return `<section class="chief-chat" role="dialog" aria-modal="true" aria-labelledby="chief-title">
    <header class="chief-header">
      <button type="button" class="chief-icon-button chief-back" aria-label="Back from Chief"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
      <div class="chief-heading"><h1 id="chief-title">Chief</h1><span>Scheduling assistant</span></div>
      <div class="chief-menu-wrap"><button type="button" class="chief-icon-button chief-more" aria-label="Conversation options" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button><div class="chief-menu" hidden><button type="button" class="chief-new">New Conversation</button></div></div>
    </header>
    <div class="chief-messages" role="log" aria-label="Conversation with Chief" aria-live="polite" aria-relevant="additions text"></div>
    <div class="chief-status" role="status"></div>
    <div class="chief-attachment-notice" hidden></div><div class="chief-roster-review" hidden></div>
    <form class="chief-composer"><button type="button" class="chief-attach chief-icon-button" aria-label="Attach volunteer roster"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-6 12 8-8"/></svg></button><input type="file" class="chief-roster-file" accept="image/*" hidden><div class="chief-message-box"><div class="chief-attachment" hidden></div><label class="sr-only" for="chief-input">Message Chief</label><textarea id="chief-input" rows="1" maxlength="8000" placeholder="Message Chief" enterkeyhint="enter"></textarea></div><button type="submit" class="chief-send" aria-label="Send message" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></form>
  </section>`;
}
export function chiefMessagesMarkup(conversation) {
  if (!conversation?.messages.length) return `<div class="chief-empty"><h2>A little help with<br>your next shift.</h2><p>Tell me what you’re planning.<br>We’ll work out the rotations together.</p><div class="chief-suggestions"><button type="button" data-chief-suggestion="Help me plan a rotation for my next shift.">Plan a rotation ${suggestionArrow}</button><button type="button" data-chief-suggestion="What do you need to create my schedule?">Get started with a schedule ${suggestionArrow}</button><button type="button" data-chief-suggestion="Help me revise my current rotation draft.">Revise a rotation ${suggestionArrow}</button></div></div>`;
  return conversation.messages.map(message => {
    const time = new Date(message.createdAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    const cards = (message.draftIds || []).map(id => conversation.drafts.find(d => d.id === id)).filter(Boolean).map(d => `<article class="chief-draft"><div class="chief-draft-eyebrow">${chiefSparkle}<span>ROTATION DRAFT</span></div><h3>${escape(d.location)}</h3><p>${escape(d.request.date)} · ${escape(d.request.duration)} min rotations</p><p>${escape(d.rows[0]?.time.split(' - ')[0])} – ${escape(d.rows.at(-1)?.time.split(' - ')[1])}</p><p class="chief-draft-meta">${escape(d.request.names.length)} volunteers · ${escape(d.timezone)}</p><span class="chief-validated">${validationCheck}<span>Assignments checked</span></span>${d.validation.warnings.map(w => `<p class="chief-warning">${escape(w)}</p>`).join('')}<button type="button" class="chief-review" data-chief-draft="${escape(d.id)}">Review Schedule ${reviewArrow}</button></article>`).join('');
    // Escape first; support emphasis only, never execute model HTML or links.
    const text = escape(message.text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    return `<div class="chief-message chief-message-${message.role === 'user' ? 'user' : 'assistant'}" data-message-id="${escape(message.id)}"><span class="sr-only">${message.role === 'user' ? 'You' : 'Chief'}:</span>${text ? `<div class="chief-bubble">${text}</div>` : ''}${message.attachment ? `<div class="chief-screenshot" data-chief-attachment="${escape(message.attachment.id)}"></div>` : ''}${message.rosterId ? `<div class="chief-roster-summary">Volunteer roster · ${escape(message.rosterCount)} volunteers</div>` : ''}${cards}<time>${escape(time)}</time></div>`;
  }).join('');
}
