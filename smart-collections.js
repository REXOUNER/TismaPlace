(() => {
  const STORAGE_KEY = 'tisma-smart-collections';
  let editingId = null;

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function getCollections() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string').slice(0, 100);
    } catch {
      return [];
    }
  }

  function getCollection(id) {
    return getCollections().find((item) => item.id === id) || null;
  }

  function gameMatches(game, rule) {
    if (rule.platform && rule.platform !== 'all') {
      const platformMatches = rule.platform === 'Steam' ? String(game.source || '').includes('Steam') : game.source === rule.platform;
      if (!platformMatches) return false;
    }
    if (rule.genre && rule.genre !== 'all' && genreFor(game) !== rule.genre) return false;
    if (rule.status && rule.status !== 'all' && (game.status || 'À jouer') !== rule.status) return false;
    if (rule.favorite === 'yes' && !game.favorite) return false;
    if (rule.favorite === 'no' && game.favorite) return false;
    if (rule.tag) {
      const expected = rule.tag.trim().toLocaleLowerCase('fr');
      if (!tagsFor(game).some((tag) => tag.toLocaleLowerCase('fr') === expected)) return false;
    }
    const inactivity = String(rule.inactive || 'all');
    if (inactivity === 'never' && game.lastPlayed) return false;
    if (/^(7|30|90)$/.test(inactivity) && game.lastPlayed && Date.now() - Number(game.lastPlayed) < Number(inactivity) * 86400000) return false;
    return true;
  }

  function describeRules(rule) {
    const parts = [];
    if (rule.platform && rule.platform !== 'all') parts.push(rule.platform);
    if (rule.genre && rule.genre !== 'all') parts.push(rule.genre);
    if (rule.status && rule.status !== 'all') parts.push(rule.status);
    if (rule.favorite === 'yes') parts.push('Favoris');
    if (rule.favorite === 'no') parts.push('Hors favoris');
    if (rule.tag) parts.push('Étiquette : ' + rule.tag);
    if (rule.inactive === 'never') parts.push('Jamais lancés');
    else if (['7', '30', '90'].includes(String(rule.inactive))) parts.push('Inactifs ' + rule.inactive + ' j');
    return parts.length ? parts.join(' · ') : 'Tous tes jeux';
  }

  function renderCards() {
    return getCollections().map((item) => {
      const count = games.filter((game) => gameMatches(game, item.rules || {})).length;
      return `<article class="collection-card smart-user-card"><button class="collection-open" data-smart-collection="${escapeHtml(item.id)}"><span class="collection-card-icon">✧</span><strong>${escapeHtml(item.name)}</strong><small>${count} jeu${count === 1 ? '' : 'x'}</small><em>${escapeHtml(describeRules(item.rules || {}))}</em></button><button class="smart-collection-edit" data-smart-edit="${escapeHtml(item.id)}" title="Modifier la collection" aria-label="Modifier ${escapeHtml(item.name)}">✎</button><button class="smart-collection-delete" data-smart-delete="${escapeHtml(item.id)}" title="Supprimer la collection" aria-label="Supprimer ${escapeHtml(item.name)}">×</button></article>`;
    }).join('');
  }

  window.getCustomSmartCollections = getCollections;
  window.getCustomSmartCollection = getCollection;
  window.matchesCustomSmartCollection = gameMatches;
  window.renderCustomSmartCollectionsMarkup = renderCards;

  function showToast(message) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.tismaSmartToastTimer);
    window.tismaSmartToastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function fillGenres(selected = 'all') {
    const select = document.querySelector('#smart-collection-genre');
    if (!select) return;
    const values = [...new Set(games.map((game) => genreFor(game)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (selected !== 'all' && !values.includes(selected)) values.unshift(selected);
    select.innerHTML = '<option value="all">Tous les genres</option>' + values.map((genre) => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
    select.value = values.includes(selected) ? selected : 'all';
  }

  function openEditor(item = null) {
    editingId = item?.id || null;
    document.querySelector('#smart-collection-name').value = item?.name || '';
    const rules = item?.rules || {};
    document.querySelector('#smart-collection-platform').value = rules.platform || 'all';
    fillGenres(rules.genre || 'all');
    document.querySelector('#smart-collection-status').value = rules.status || 'all';
    document.querySelector('#smart-collection-favorite').value = rules.favorite || 'all';
    document.querySelector('#smart-collection-inactive').value = String(rules.inactive || 'all');
    document.querySelector('#smart-collection-tag').value = rules.tag || '';
    document.querySelector('#smart-collection-save').textContent = editingId ? 'ENREGISTRER LES MODIFICATIONS' : 'CRÉER LA VUE';
    document.querySelector('#smart-collection-cancel').classList.toggle('hidden', !editingId);
    const builder = document.querySelector('#smart-collection-builder');
    builder.open = true;
    document.querySelector('#smart-collection-name').focus();
    builder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetEditor() {
    editingId = null;
    document.querySelector('#smart-collection-name').value = '';
    document.querySelector('#smart-collection-platform').value = 'all';
    document.querySelector('#smart-collection-status').value = 'all';
    document.querySelector('#smart-collection-favorite').value = 'all';
    document.querySelector('#smart-collection-inactive').value = 'all';
    document.querySelector('#smart-collection-tag').value = '';
    fillGenres();
    document.querySelector('#smart-collection-save').textContent = 'CRÉER LA VUE';
    document.querySelector('#smart-collection-cancel').classList.add('hidden');
  }

  function saveEditor() {
    const wasEditing = Boolean(editingId);
    const name = document.querySelector('#smart-collection-name').value.trim().slice(0, 24);
    const rules = {
      platform: document.querySelector('#smart-collection-platform').value,
      genre: document.querySelector('#smart-collection-genre').value,
      status: document.querySelector('#smart-collection-status').value,
      favorite: document.querySelector('#smart-collection-favorite').value,
      inactive: document.querySelector('#smart-collection-inactive').value,
      tag: document.querySelector('#smart-collection-tag').value.trim().slice(0, 24),
    };
    if (!name) return showToast('Donne un nom à ta collection intelligente.');
    if (!Object.values(rules).some((value) => value && value !== 'all')) return showToast('Choisis au moins un critère pour créer cette vue.');

    const collections = getCollections();
    if (collections.some((item) => item.id !== editingId && item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
      return showToast('Une collection intelligente porte déjà ce nom.');
    }

    if (editingId) {
      const item = collections.find((entry) => entry.id === editingId);
      if (!item) return showToast('Cette collection n’existe plus.');
      item.name = name;
      item.rules = rules;
    } else {
      collections.push({ id: 'smart-' + crypto.randomUUID(), name, rules });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
    resetEditor();
    document.querySelector('#smart-collection-builder').open = false;
    renderCollectionManager();
    render();
    showToast(wasEditing ? 'Collection intelligente modifiée.' : 'Collection intelligente créée.');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'smart-collection-save') {
      event.preventDefault();
      saveEditor();
    } else if (button.id === 'smart-collection-cancel') {
      resetEditor();
      document.querySelector('#smart-collection-builder').open = false;
    } else if (button.dataset.smartEdit) {
      openEditor(getCollection(button.dataset.smartEdit));
    } else if (button.dataset.smartDelete) {
      const id = button.dataset.smartDelete;
      const item = getCollection(id);
      if (!item || !confirm(`Supprimer la collection intelligente « ${item.name} » ?`)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getCollections().filter((entry) => entry.id !== id)));
      if (selectedSmartCollection === id) selectedSmartCollection = null;
      renderCollectionManager();
      render();
      showToast('Collection intelligente supprimée.');
    }
  });

  document.querySelector('#smart-collection-builder').addEventListener('toggle', (event) => {
    if (event.target.open) fillGenres(document.querySelector('#smart-collection-genre').value);
  });
  document.querySelector('#smart-collection-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector('#smart-collection-save').click();
    }
  });

  setTimeout(() => {
    if (typeof renderCollectionManager === 'function') renderCollectionManager();
  }, 0);
})();
