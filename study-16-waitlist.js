const body=document.body;
const toggle=document.querySelector('#signup-cta');
const panel=document.querySelector('#waitlist-panel');
const form=document.querySelector('#waitlist-form');
const email=document.querySelector('#waitlist-email');
const consent=document.querySelector('#waitlist-consent');
const close=document.querySelector('.waitlist-close');
const status=document.querySelector('#waitlist-status');
let opened=false;
function syncViewport(){
 const height=Math.round(window.visualViewport?.height||window.innerHeight);
 body.style.setProperty('--waitlist-viewport',height+'px');
 body.dataset.waitlistCompact=String(opened&&height<430);
}
function setOpen(value){
 opened=value;
 body.dataset.waitlistOpen=String(value);
 toggle.setAttribute('aria-expanded',String(value));
 // The trigger yields its exact typographic area to the field. It stays in
 // the DOM for a reliable focus return, without remaining an invisible tab stop.
 toggle.tabIndex=value?-1:0;
 panel.inert=!value;
 panel.setAttribute('aria-hidden',String(!value));
 syncViewport();
 if(value)email.focus({preventScroll:true});
 else toggle.focus({preventScroll:true});
}
toggle.addEventListener('click',()=>setOpen(true));
close.addEventListener('click',()=>setOpen(false));
panel.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();setOpen(false);}
 else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.isComposing){
  event.preventDefault();if(!event.repeat)form.requestSubmit();
 }
});
form.addEventListener('submit',event=>{
 event.preventDefault();status.textContent='';
 email.removeAttribute('aria-invalid');consent.removeAttribute('aria-invalid');
 if(!email.value.trim()||!email.validity.valid){
  status.textContent='Enter a valid email address.';
  email.setAttribute('aria-invalid','true');email.focus({preventScroll:true});return;
 }
 if(!consent.checked){
  status.textContent='Please confirm that you would like to hear from us.';
  consent.setAttribute('aria-invalid','true');consent.focus({preventScroll:true});return;
 }
 status.textContent='Preview complete. Your address has not been saved or sent.';
});
document.querySelector('.skip')?.addEventListener('click',event=>{
 if(!opened)return;event.preventDefault();email.focus({preventScroll:true});
});
window.visualViewport?.addEventListener('resize',syncViewport);
window.addEventListener('resize',syncViewport);
window.addEventListener('pageshow',syncViewport);
syncViewport();
