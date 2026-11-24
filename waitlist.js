import './site-menu.js?v=2026-menu3';

const SERVICE_ERROR = 'We couldn’t confirm your signup. Please try again.';

async function submitWaitlistEmail(form, address) {
  if (!form.getAttribute('action')?.trim() || form.method !== 'post') {
    return { kind: 'request', message: SERVICE_ERROR };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, consent: true }),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 429) {
      return { kind: 'request', message: 'Too many requests. Please wait a minute before trying again.' };
    }
    const responseType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (responseType !== 'application/json') {
      return { kind: 'request', message: SERVICE_ERROR };
    }
    const data = await response.json();
    if (response.status === 400 && data?.error === 'invalid_email') {
      return { kind: 'email', message: 'Check the email address.' };
    }
    if (response.status === 200 && data?.ok === true) {
      return { kind: 'ok' };
    }
    return { kind: 'request', message: SERVICE_ERROR };
  } catch {
    return {
      kind: 'request',
      message: controller.signal.aborted ? 'The request timed out. Please try again.' : SERVICE_ERROR,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function initHomeWaitlist() {
  const waitlist = document.querySelector('.waitlist');
  const trigger = document.querySelector('#signup-cta');
  if (!waitlist || !trigger) return;
  const triggerLabel = trigger.querySelector('.join-label');
  const panel = document.querySelector('#waitlist-panel');
  const title = document.querySelector('#waitlist-title');
  const form = document.querySelector('#waitlist-form');
  const email = form.querySelector('#waitlist-email');
  const emailError = form.querySelector('#waitlist-email-error');
  const requestError = form.querySelector('#waitlist-request-error');
  const join = form.querySelector('button[type="submit"]');
  const joinText = join.querySelector('.action-text') || join;
  const result = document.querySelector('.waitlist-result');
  const status = document.querySelector('#waitlist-status');
  const done = result.querySelector('.waitlist-done');
  const invitation = triggerLabel.textContent;
  const joinLabel = joinText.textContent;
  let open = false;
  let pending = false;
  let resetOnOpen = false;

  function revealInPanel(target, preceding) {
    if (!open || !panel.contains(target) || panel.scrollHeight <= panel.clientHeight) return;
    const visibleTop = panel.getBoundingClientRect().top + panel.clientTop + 6;
    const available = panel.clientHeight - 12;
    const box = target.getBoundingClientRect();
    let top = box.top;
    if (preceding) {
      const start = preceding.getBoundingClientRect().top;
      if (box.bottom - start <= available) top = Math.min(top, start);
    }
    if (top < visibleTop || box.bottom - top > available) {
      panel.scrollTop += Math.floor(top - visibleTop);
    } else if (box.bottom > visibleTop + available) {
      panel.scrollTop += Math.ceil(box.bottom - visibleTop - available);
    }
  }

  function revealPanelState() {
    if (!open) return;
    if (!result.hidden) revealInPanel(done, status);
    else if (!emailError.hidden) revealInPanel(emailError, email);
    else if (!requestError.hidden) revealInPanel(requestError, email);
    else revealInPanel(document.activeElement);
  }

  function syncViewport() {
    const height = Math.round(window.visualViewport?.height || window.innerHeight);
    document.body.style.setProperty('--waitlist-viewport', height + 'px');
    document.body.dataset.waitlistCompact = String(open && height < 430);
    revealPanelState();
  }

  function showError(node, message = '') {
    node.hidden = !message;
    node.textContent = message;
    if (message) revealInPanel(node, email);
  }

  function clearErrors() {
    showError(emailError);
    showError(requestError);
    email.removeAttribute('aria-invalid');
  }

  function focusPanelControl(control) {
    if (open && !document.hidden && (waitlist.contains(document.activeElement) || document.activeElement === document.body)) {
      control.focus({ preventScroll: true });
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
    if (resetOnOpen) resetForm();
    open = true;
    document.body.dataset.waitlistOpen = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    triggerLabel.textContent = 'Close';
    trigger.setAttribute('aria-label', 'Close waitlist');
    panel.inert = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.scrollTop = 0;
    (result.hidden ? email : done).focus({ preventScroll: true });
    syncViewport();
  }

  function closeWaitlist(restoreFocus = true) {
    if (!open) return;
    open = false;
    resetOnOpen = !result.hidden;
    document.body.dataset.waitlistOpen = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    triggerLabel.textContent = invitation;
    trigger.removeAttribute('aria-label');
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    syncViewport();
    if (restoreFocus) {
      trigger.focus({ preventScroll: true });
      trigger.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function setPending(value) {
    pending = value;
    form.setAttribute('aria-busy', String(value));
    if (value && document.activeElement === join) email.focus({ preventScroll: true });
    email.readOnly = value;
    join.disabled = value;
    joinText.textContent = value ? 'Joining…' : joinLabel;
  }

  function showConfirmation() {
    form.hidden = true;
    email.value = '';
    title.textContent = 'You’re on the list';
    result.hidden = false;
    status.textContent = 'We’ll email you when Ruth launches.';
    panel.scrollTop = 0;
    focusPanelControl(done);
    revealInPanel(done, status);
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
    setPending(true);
    try {
      const outcome = await submitWaitlistEmail(form, address);
      if (outcome.kind === 'ok') showConfirmation();
      else if (outcome.kind === 'email') showEmailError(outcome.message);
      else showError(requestError, outcome.message);
    } finally {
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
  email.addEventListener('input', () => {
    if (emailError.hidden && requestError.hidden) return;
    clearErrors();
    revealInPanel(email);
  });
  document.querySelector('.skip')?.addEventListener('click', event => {
    event.preventDefault();
    if (!open) openWaitlist();
    else (result.hidden ? email : done).focus({ preventScroll: true });
  });
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.addEventListener('resize', syncViewport);
  window.addEventListener('pageshow', syncViewport);
  syncViewport();

  if (new URLSearchParams(location.search).has('waitlist')) {
    const clean = new URL(location.href);
    clean.searchParams.delete('waitlist');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    requestAnimationFrame(() => openWaitlist());
  }
}

function initInlineWaitlists() {
  document.querySelectorAll('[data-inline-waitlist]').forEach(container => {
    const form = container.querySelector('form');
    const email = container.querySelector('input[type="email"]');
    const submit = container.querySelector('button[type="submit"]');
    const submitText = submit?.querySelector('.action-text') || submit;
    const error = container.querySelector('[data-waitlist-error]');
    const status = container.querySelector('[data-waitlist-status]');
    if (!form || !email || !submit || !error || !status) return;
    const submitLabel = submitText.textContent;
    let pending = false;

    function setError(message = '') {
      error.hidden = !message;
      error.textContent = message;
      if (message) email.setAttribute('aria-invalid', 'true');
      else email.removeAttribute('aria-invalid');
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      setError();
      const address = email.value.trim();
      if (!address || !email.validity.valid) {
        setError(address ? 'Check the email address.' : 'Enter your email address.');
        email.focus();
        return;
      }
      pending = true;
      form.setAttribute('aria-busy', 'true');
      email.readOnly = true;
      submit.disabled = true;
      submitText.textContent = 'Joining…';
      try {
        const outcome = await submitWaitlistEmail(form, address);
        if (outcome.kind === 'ok') {
          form.hidden = true;
          email.value = '';
          status.hidden = false;
          status.textContent = 'You’re on the list. We’ll email you when Ruth launches.';
        } else {
          setError(outcome.message);
          email.focus();
        }
      } finally {
        pending = false;
        form.setAttribute('aria-busy', 'false');
        email.readOnly = false;
        submit.disabled = false;
        submitText.textContent = submitLabel;
      }
    });

    email.addEventListener('input', () => {
      if (!error.hidden) setError();
    });
  });
}

initHomeWaitlist();
initInlineWaitlists();
