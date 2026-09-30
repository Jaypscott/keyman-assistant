import { rosterReviewMarkup } from '../../components/RosterReview.mjs';
import { scanRosterImage, validateReviewedRoster, MAX_ROSTER } from '../volunteers/rosterImport.mjs';
import { prepareRosterReview, createVolunteerContact } from '../volunteers/rosterService.mjs';
export function createChiefRoster({ overlay, win, getPlugin, onChange, isLocked, onOperation, isVisible }) {
  const attachment = overlay.querySelector('.chief-attachment');
  const notice = overlay.querySelector('.chief-attachment-notice');
  const review = overlay.querySelector('.chief-roster-review');
  const attach = overlay.querySelector('.chief-attach');
  const fileInput = overlay.querySelector('.chief-roster-file');
  const images = new Map();
  let pendingId = null, activeId = null, rows = [], scanning = null, epoch = 0, message = '', previousFocus, conversation = null;
  const button = (host, label, action, disabled = isLocked()) => {
    const b=overlay.ownerDocument.createElement('button'); b.type='button'; b.textContent=label; b.disabled=disabled; b.onclick=action; host.append(b); return b;
  };
  function release(id) {
    const local=images.get(id); if(local?.url)win.URL.revokeObjectURL(local.url);
    images.delete(id);
  }
  function imagePreview(host, local) {
    if(!local?.url)return;
    const img=overlay.ownerDocument.createElement('img');img.src=local.url;img.alt='Attached volunteer screenshot';img.className='chief-screenshot-thumbnail';host.append(img);
  }
  function paint() {
    // Keep the preview node stable while typing and polling so keyboard focus stays put.
    attachment.hidden = !pendingId;
    if(attachment.dataset.imageId !== (pendingId || '')) {
      attachment.replaceChildren(); attachment.dataset.imageId=pendingId || '';
      if(pendingId) {
        imagePreview(attachment,images.get(pendingId));
        const remove=button(attachment,'',()=>{
          release(pendingId);pendingId=null;message='';paint();onChange();
          overlay.querySelector('textarea').focus();
        });
        remove.className='chief-remove-screenshot';remove.setAttribute('aria-label','Remove screenshot');
        remove.innerHTML='<span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 7 10 10M17 7 7 17"/></svg></span>';
      }
    }
    const remove=attachment.querySelector('button');if(remove)remove.disabled=isLocked();
    notice.replaceChildren();notice.hidden=!message;
    if(message) {
      const text=overlay.ownerDocument.createElement('span');text.setAttribute('role','status');text.textContent=message;notice.append(text);
      button(notice,'Dismiss',()=>{message='';paint();});
    }
    for(const host of overlay.querySelectorAll('[data-chief-attachment]')) {
      const id=host.dataset.chiefAttachment, a=conversation?.attachments?.find(a=>a.id===id), local=images.get(id);
      host.replaceChildren();
      if(!a)continue;
      if(['completed','cancelled'].includes(a.state)) {
        if(activeId===id){epoch++;scanning?.abort();scanning=null;close(false);activeId=null;}
        release(id);
      } else imagePreview(host,local);
      const label=overlay.ownerDocument.createElement('p');label.setAttribute('role','status');host.append(label);
      label.textContent=a.state==='completed' ? 'Volunteer screenshot · reviewed' : a.state==='cancelled' ? 'Screenshot discarded' : 'Volunteer screenshot';
      if(['completed','cancelled'].includes(a.state))continue;
      if(local?.working) {label.textContent='Saving roster…';continue;}
      if(local?.error)label.textContent=local.error;
      if(scanning && activeId===id) {
        label.textContent='Reading roster on this device…';
        button(host,'Cancel',()=>{epoch++;scanning.abort();scanning=null;local.error='Reading cancelled. You can retry or discard the screenshot.';paint();onChange();},false);continue;
      }
      if(a.state==='requested') {
        if(!local?.file){label.textContent='Reattach this screenshot on your iPhone to read it. Images are not saved or synced.';}
        else if(local.operation)button(host,'Retry saving',()=>complete(id,local.operation.action,local.operation.roster));
        else if(local.rows)button(host,'Review volunteers',()=>open(local.rows,id));
        else if(local.attempted)button(host,'Retry reading',()=>scan(id));
        else label.textContent='Waiting to read this screenshot on your iPhone…';
      } else {
        button(host,'Analyze screenshot',()=>complete(id,'analyze'));
      }
      if(!local?.operation)button(host,'Discard screenshot',()=>complete(id,'cancel'));
      else if(a.state!=='requested')button(host,'Retry saving',()=>complete(id,local.operation.action,local.operation.roster));
    }
  }
  async function complete(id, action, roster) {
    if(isLocked())return;
    const a=conversation?.attachments?.find(a=>a.id===id);if(!a)return;
    let local=images.get(id);
    if(!local){local={};images.set(id,local);}
    const ticket=epoch;
    const operation=local.operation ||= {operationId:win.crypto.randomUUID(),conversationId:conversation.id,attachmentId:id,messageId:a.messageId,action,...(roster?{roster}: {})};
    local.working=true;local.error='';paint();
    try {
      await onOperation(operation);
      if(ticket!==epoch)return;
      local.operation=null;local.working=false;
      if(action==='complete'||action==='cancel'){release(id);close(false);activeId=null;}
    } catch(e) {if(ticket===epoch){local.error=e.message;local.working=false;}}
    if(ticket===epoch){paint();onChange();}
  }
  async function scan(id) {
    const local=images.get(id);
    if(!local?.file || scanning || isLocked())return;
    const ticket=epoch; const controller=new AbortController(); scanning=controller;activeId=id;local.attempted=true;local.error='';paint();onChange();
    try {
      const found=await scanRosterImage(local.file,{plugin:getPlugin(),signal:controller.signal,FileReaderClass:win.FileReader});
      if(ticket!==epoch)return;
      local.rows=prepareRosterReview(found,found.length);
      if(isVisible())open(local.rows,id);
    } catch(e){if(ticket===epoch)local.error=e.message;}
    finally{if(ticket===epoch){scanning=null;paint();onChange();}}
  }
  function close(notify = true) {
    review.hidden=true; review.replaceChildren();
    for (const child of overlay.querySelector('.chief-chat').children) if(child!==review) child.inert=false;
    previousFocus?.focus?.();
    if(notify) onChange();
  }
  function renderReview(error='') {
    review.innerHTML=rosterReviewMarkup({contacts:rows,capacity:MAX_ROSTER,message:error,confirmLabel:'Use these volunteers',capacityLabel:'Up to 8 volunteers; deselect any you do not need',description:'Confirm names and numbers. Only names are sent to Chief’s AI.'});
    review.querySelector('#closeRosterReview').onclick=()=>close();
    review.querySelector('#closeRosterReviewBackdrop').onclick=()=>close();
    review.querySelector('#discardRosterReview').onclick=()=>{close(false);void complete(activeId,'cancel');};
    const updateControls = () => {
      const count = rows.filter(c => c.selected).length;
      review.querySelector('.roster-capacity strong').textContent = `${count} selected`;
      review.querySelector('#applyRosterReview').disabled = !count || count > MAX_ROSTER;
    };
    review.querySelectorAll('.roster-review-input').forEach(input => {
      input.oninput=()=>{ rows[Number(input.dataset.index)][input.dataset.field]=input.value; };
      input.onchange=()=>{
        const row=rows[Number(input.dataset.index)]; Object.assign(row,createVolunteerContact(row));
        input.value=row[input.dataset.field];
        const checkbox=review.querySelector(`.roster-select[data-index="${input.dataset.index}"]`);
        if(!row.name.trim())row.selected=false;
        checkbox.disabled=!row.name.trim(); checkbox.checked=row.selected; updateControls();
      };
    });
    review.querySelectorAll('.roster-select').forEach(input=>input.onchange=()=>{rows[Number(input.dataset.index)].selected=input.checked;updateControls();});
    review.querySelector('#applyRosterReview').onclick=()=>{
      try { const contacts=validateReviewedRoster(rows.filter(c=>c.selected)); close(false); void complete(activeId,'complete',contacts); }
      catch(e){renderReview(e.message);}
    };
  }
  function open(nextRows, id) {
    activeId=id;
    previousFocus=overlay.ownerDocument.activeElement; rows=nextRows; review.hidden=false;
    for(const child of overlay.querySelector('.chief-chat').children) if(child!==review) child.inert=true;
    renderReview(); review.querySelector('#closeRosterReview').focus();
  }
  attach.onclick=()=>{
    if(isLocked() || scanning)return;
    if(!getPlugin()?.recognizeRosterImage){message='Roster image import is available in the installed iPhone app.';paint();return;}
    fileInput.value=''; fileInput.click();
  };
  fileInput.onchange=()=>{
    const file=fileInput.files?.[0]; fileInput.value=''; if(!file || isLocked())return;
    if(!getPlugin()?.recognizeRosterImage){message='Roster image import is available in the installed iPhone app.';paint();return;}
    if((file.type && !file.type.startsWith('image/')) || file.size>20*1024*1024){message='Choose an image smaller than 20 MB.';paint();return;}
    if(pendingId)release(pendingId);
    pendingId=win.crypto.randomUUID();images.set(pendingId,{file,url:win.URL.createObjectURL(file)});
    message='';paint();onChange();
  };
  return {
    get value(){return pendingId ? {id:pendingId,kind:'roster_screenshot'}:null;},
    get busy(){return Boolean(scanning) || !review.hidden || [...images.values()].some(v=>v.working);},
    get reviewing(){return !review.hidden;},
    closeReview:close,
    sent(){pendingId=null;message='';paint();},
    update(next){
      conversation=next;attach.disabled=isLocked() || Boolean(scanning);paint();
      if(!isVisible() || isLocked() || scanning || !review.hidden)return;
      const ready=conversation?.attachments?.find(a=>a.state==='requested' && images.get(a.id)?.file && !images.get(a.id).attempted);
      if(ready)queueMicrotask(()=>{if(isVisible() && conversation?.attachments?.some(a=>a.id===ready.id&&a.state==='requested') && !images.get(ready.id)?.attempted)void scan(ready.id);});
    },
    clear(){epoch++;scanning?.abort();scanning=null;for(const id of images.keys())release(id);pendingId=null;activeId=null;rows=[];message='';conversation=null;fileInput.value='';close(false);paint();},
  };
}
