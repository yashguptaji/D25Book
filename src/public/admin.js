(function () {
  const input = document.getElementById('adminUserSearch');
  const list = document.getElementById('adminUsersList');
  if (!input || !list) return;

  let timer;

  function renderUsers(users) {
    list.innerHTML = '';
    users.forEach((user) => {
      const article = document.createElement('article');
      article.className = 'person-card';

      const left = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = user.alias || user.display_name;
      const email = document.createElement('p');
      email.className = 'muted';
      email.textContent = user.email;
      const login = document.createElement('p');
      login.className = 'muted';
      login.textContent = `Last login: ${new Date(user.last_login_at).toLocaleString()}`;

      left.appendChild(name);
      left.appendChild(email);
      left.appendChild(login);

      const form = document.createElement('form');
      form.action = `/admin/users/${user.id}/delete`;
      form.method = 'POST';
      form.className = 'inline-form';
      form.onsubmit = function () {
        return window.confirm('Remove this user?');
      };

      const actions = document.createElement('div');
      actions.className = 'inline-actions';

      const view = document.createElement('a');
      view.href = `/profile/${user.share_code}`;
      view.className = 'secondary-btn';
      view.textContent = 'View Page';

      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'danger-btn';
      btn.textContent = 'Remove User';
      actions.appendChild(view);
      actions.appendChild(btn);
      form.appendChild(actions);

      article.appendChild(left);
      article.appendChild(form);
      list.appendChild(article);
    });
  }

  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(async function () {
      try {
        const q = encodeURIComponent(input.value.trim());
        const res = await fetch(`/admin/api/users?q=${q}`);
        if (!res.ok) return;
        const data = await res.json();
        renderUsers(Array.isArray(data.users) ? data.users : []);
      } catch (_error) {
        // No-op for transient errors.
      }
    }, 180);
  });
})();
