'use strict';
// Potwierdzenie przed usunięciem konta (CSP nie pozwala na skrypty inline).
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
});
