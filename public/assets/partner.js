// Small enhancements for the partner pages. Every page works without this file.
(function () {
  'use strict';
  // Move focus to a message the server put at the top (a form error or a success note), so screen readers hear it.
  var focus = document.querySelector('[data-focus]');
  if (focus) focus.focus();

  // Copy the referral link.
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    var input = document.getElementById(button.getAttribute('data-copy'));
    var status = document.querySelector('[data-copy-status]');
    if (!input) return;
    button.hidden = false;
    button.addEventListener('click', function () {
      var done = function (ok) { if (status) status.textContent = ok ? 'Link copied.' : 'Select the link and copy it.'; };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(input.value).then(function () { done(true); }, function () { input.select(); done(false); });
      } else { input.select(); try { done(document.execCommand('copy')); } catch (e) { done(false); } }
    });
  });
  document.querySelectorAll('#ref-link').forEach(function (input) { input.addEventListener('focus', function () { input.select(); }); });

  // Print the counter card.
  document.querySelectorAll('[data-print]').forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', function () { window.print(); });
  });

  // Busy state while a form is sent, so nobody presses twice.
  document.querySelectorAll('form[data-busy]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var button = form.querySelector('button[type="submit"]');
      if (!button || button.getAttribute('aria-busy') === 'true') return;
      setTimeout(function () { button.setAttribute('aria-busy', 'true'); button.disabled = true; button.textContent = form.getAttribute('data-busy').replace('&hellip;', '…'); }, 0);
    });
  });
})();
