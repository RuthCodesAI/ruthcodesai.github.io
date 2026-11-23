const waitlist = document.querySelector('.waitlist');
const trigger = document.querySelector('#signup-cta');
const triggerLabel = trigger.querySelector('.join-label');
const panel = document.querySelector('#waitlist-panel');
const title = document.querySelector('#waitlist-title');
const form = document.querySelector('#waitlist-form');
const email = form.querySelector('#waitlist-email');
const emailError = form.querySelector('#waitlist-email-error');
const requestError = document.querySelector('#waitlist-request-error');
const join = form.querySelector('button[type="submit"]');
const result = document.querySelector('.waitlist-result');
const status = document.querySelector('#waitlist-status');
const done = result.querySelector('.waitlist-done');
const invitation = triggerLabel.textContent;
const joinLabel = join.textContent;
const serviceError = 'We couldn’t confirm your signup. Please try again.';
let open = false;
let pending = false;
let resetOnOpen = false;

function syncViewport() {
  const height = Math.round(window.visualViewport?.height || window.innerHeight);
  document.body.style.setProperty('--waitlist-viewport', height + 'px');
  document.body.dataset.waitlistCompact = String(open && height < 430);
}

function showError(node, message = '') {
  node.hidden = !message;
  node.textContent = message;
}

function clearErrors() {
  showError(emailError);
  showError(requestError);
  email.removeAttribute('aria-invalid');
}

function focusPanelControl(control) {
  if (open && !document.hidden && (waitlist.contains(document.activeElement) || document.activeElement === document.body)) {
    control.focus({preventScroll: true});
  }
}

function showEmailError(message) {
  showError(emailError, message);
  email.setAttribute('aria-invalid', 'true');
  focusPanelControl(email);
}

function resetForm() {
  form.reset();
  clearErrors();
  form.hidden = false;
  result.hidden = true;
  title.textContent = invitation;
  status.textContent = '';
  resetOnOpen = false;
}

function openWaitlist() {
  // A result received while closed is shown the next time the visitor opens the panel.
  if (resetOnOpen) resetForm();
  open = true;
  document.body.dataset.waitlistOpen = 'true';
  trigger.setAttribute('aria-expanded', 'true');
  triggerLabel.textContent = 'Close';
  trigger.setAttribute('aria-label', 'Close waitlist');
  panel.inert = false;
  panel.setAttribute('aria-hidden', 'false');
  panel.scrollTop = 0;
  syncViewport();
  (result.hidden ? email : done).focus({preventScroll: true});
}

function closeWaitlist(restoreFocus = true) {
  if (!open) return;
  open = false;
  resetOnOpen = !result.hidden;
  document.body.dataset.waitlistOpen = 'false';
  trigger.setAttribute('aria-expanded', 'false');
  triggerLabel.textContent = invitation;
  trigger.removeAttribute('aria-label');
  if (restoreFocus) trigger.focus({preventScroll: true});
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  syncViewport();
}

function setPending(value) {
  pending = value;
  form.setAttribute('aria-busy', String(value));
  // Keep a focusable control in the sheet when the submit button becomes disabled.
  if (value && document.activeElement === join) email.focus({preventScroll: true});
  email.readOnly = value;
  join.disabled = value;
  join.textContent = value ? 'Joining…' : joinLabel;
}

function showConfirmation() {
  form.hidden = true;
  email.value = '';
  title.textContent = 'You’re on the list';
  result.hidden = false;
  status.textContent = 'We’ll email you when Ruth launches.';
  panel.scrollTop = 0;
  focusPanelControl(done);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!open || pending || form.hidden) return;
  clearErrors();
  const address = email.value.trim();
  if (!address || !email.validity.valid) {
    showEmailError(address ? 'Check the email address.' : 'Enter your email address.');
    return;
  }
  if (!form.getAttribute('action')?.trim() || form.method !== 'post') {
    showError(requestError, serviceError);
    return;
  }
  setPending(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: address, consent: true}),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 429) {
      showError(requestError, 'Too many requests. Please wait a minute before trying again.');
      return;
    }
    const responseType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (responseType !== 'application/json') {
      showError(requestError, serviceError);
      return;
    }
    const data = await response.json();
    if (response.status === 400 && data?.error === 'invalid_email') {
      showEmailError('Check the email address.');
    } else if (response.status === 200 && data?.ok === true) {
      showConfirmation();
    } else {
      showError(requestError, serviceError);
    }
  } catch {
    showError(requestError, controller.signal.aborted ? 'The request timed out. Please try again.' : serviceError);
  } finally {
    clearTimeout(timeout);
    setPending(false);
  }
});

trigger.addEventListener('click', () => open ? closeWaitlist() : openWaitlist());
done.addEventListener('click', () => closeWaitlist());
document.addEventListener('pointerdown', event => {
  if (open && !waitlist.contains(event.target)) closeWaitlist(false);
});
waitlist.addEventListener('focusout', event => {
  if (open && event.relatedTarget && !waitlist.contains(event.relatedTarget)) {
    closeWaitlist(false);
  }
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
    if (!event.repeat && !pending) form.requestSubmit();
  }
});
email.addEventListener('input', clearErrors);
document.querySelector('.skip')?.addEventListener('click', event => {
  event.preventDefault();
  if (!open) openWaitlist();
  else (result.hidden ? email : done).focus({preventScroll: true});
});
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);
window.addEventListener('pageshow', syncViewport);
syncViewport();
