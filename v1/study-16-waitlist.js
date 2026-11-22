const waitlist = document.querySelector('.waitlist');
const trigger = document.querySelector('#signup-cta');
const triggerLabel = trigger.querySelector('.join-label');
const panel = document.querySelector('#waitlist-panel');
const title = document.querySelector('#waitlist-title');
const form = document.querySelector('#waitlist-form');
const email = document.querySelector('#waitlist-email');
const consent = document.querySelector('#waitlist-consent');
const emailError = document.querySelector('#waitlist-email-error');
const consentError = document.querySelector('#waitlist-consent-error');
const result = document.querySelector('.waitlist-result');
const status = document.querySelector('#waitlist-status');
const done = document.querySelector('.waitlist-done');
const invitation = triggerLabel.textContent;
let open = false;

function syncViewport() {
  const height = Math.round(window.visualViewport?.height || window.innerHeight);
  document.body.style.setProperty('--waitlist-viewport', height + 'px');
  document.body.dataset.waitlistCompact = String(open && height < 430);
}

function setError(control, message, text = '') {
  message.textContent = text;
  message.hidden = !text;
  if (text) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
}

function openWaitlist() {
  if (!result.hidden) {
    form.reset();
    form.hidden = false;
    result.hidden = true;
    title.textContent = invitation;
    status.textContent = '';
  }
  open = true;
  document.body.dataset.waitlistOpen = 'true';
  trigger.setAttribute('aria-expanded', 'true');
  triggerLabel.textContent = 'Close';
  trigger.setAttribute('aria-label', 'Close waitlist');
  panel.inert = false;
  panel.setAttribute('aria-hidden', 'false');
  panel.scrollTop = 0;
  syncViewport();
  email.focus({preventScroll:true});
}

function closeWaitlist(restoreFocus = true) {
  if (!open) return;
  open = false;
  document.body.dataset.waitlistOpen = 'false';
  trigger.setAttribute('aria-expanded', 'false');
  triggerLabel.textContent = invitation;
  trigger.removeAttribute('aria-label');
  if (restoreFocus) trigger.focus({preventScroll:true});
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  syncViewport();
}

trigger.addEventListener('click', () => open ? closeWaitlist() : openWaitlist());
done.addEventListener('click', () => closeWaitlist());
document.addEventListener('pointerdown', event => {
  if (open && !waitlist.contains(event.target)) closeWaitlist(false);
});
waitlist.addEventListener('focusout', event => {
  if (open && event.relatedTarget && !waitlist.contains(event.relatedTarget)) closeWaitlist(false);
});
document.addEventListener('keydown', event => {
  if (open && event.key === 'Escape') {
    event.preventDefault();
    closeWaitlist();
  }
});
form.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault();
    if (!event.repeat) form.requestSubmit();
  }
});

email.addEventListener('input', () => setError(email, emailError));
consent.addEventListener('change', () => setError(consent, consentError));
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!open || form.hidden) return;
  if (!email.value.trim() || !email.validity.valid) {
    setError(email, emailError, email.value.trim() ? 'Check the email address.' : 'Enter your email address.');
    email.focus();
    return;
  }
  if (!consent.checked) {
    setError(consent, consentError, 'Confirm you’d like to receive launch updates.');
    consent.focus();
    return;
  }
  form.hidden = true;
  title.textContent = 'Preview complete';
  result.hidden = false;
  status.textContent = 'Your address was checked. No signup was submitted.';
  panel.scrollTop = 0;
  done.focus({preventScroll:true});
});

document.querySelector('.skip')?.addEventListener('click', event => {
  event.preventDefault();
  if (!open) openWaitlist();
  else (form.hidden ? done : email).focus({preventScroll:true});
});
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);
window.addEventListener('pageshow', syncViewport);
syncViewport();
