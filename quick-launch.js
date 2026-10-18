(() => {
  const backdrop = document.querySelector('#quick-launch-backdrop');
  const input = document.querySelector('#quick-launch-search');
  const results = document.querySelector('#quick-launch-results');
  const hint = document.querySelector('#quick-launch-hint');
  let selectedIndex = 0;
  let returnFocus = null;

  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const isOpen = () => !backdrop.classList.contains('hidden');

  function close(restoreFocus = true) {
    backdrop.classList.add('hidden');
    input.value = '';
    results.innerHTML = '';
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function matchingGames() {
    const query = normalize(input.value);
    const available = games.filter((game) => !game.missingExecutable);
    if (!query) return available.sort((a, b) => (Number(b.lastPlayed) || 0) - (Number(a.lastPlayed) || 0) || (Number(b.launchCount) || 0) - (Number(a.launchCount) || 0) || a.name.localeCompare(b.name, 'fr')).slice(0, 8);
    return available.map((game) => {
      const name = normalize(game.name);
      const index = name.indexOf(query);
      return { game, score: index < 0 ? Infinity : (index === 0 ? 0 : 10) + index + Math.max(0, name.length - query.length) / 100 };
    }).filter((item) => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.game.name.localeCompare(b.game.name, 'fr')).slice(0, 8).map((item) => item.game);
  }

  function render() {
    const matches = matchingGames();
    selectedIndex = Math.max(0, Math.min(selectedIndex, matches.length - 1));
    hint.textContent = input.value.trim() ? `${matches.length} RÉSULTAT${matches.length === 1 ? '' : 'S'} · ↑ ↓ POUR CHOISIR` : 'TES JEUX RÉCENTS · ↑ ↓ POUR CHOISIR';
    if (!matches.length) {
      results.innerHTML = `<div class="quick-launch-empty"><span>⌕</span><strong>Aucun jeu trouvé</strong><small>Essaie un autre nom ou ajoute le jeu à ta bibliothèque.</small></div>`;
      return;
    }
    results.innerHTML = matches.map((game, index) => {
      const source = game.source?.includes('Steam') ? 'STEAM' : game.source === 'Epic Games' ? 'EPIC GAMES' : game.source === 'GOG Galaxy' ? 'GOG GALAXY' : game.source || 'LOCAL';
      const art = game.cover ? `<img class="quick-launch-art" src="${escapeHtml(game.cover)}" alt="">` : `<span class="quick-launch-art-fallback">${escapeHtml(game.name.slice(0, 1).toUpperCase())}</span>`;
      return `<button type="button" class="quick-launch-option${index === selectedIndex ? ' selected' : ''}" id="quick-launch-option-${index}" role="option" aria-selected="${index === selectedIndex}" data-play="${escapeHtml(game.id)}">${art}<span class="quick-launch-game-copy"><strong>${escapeHtml(game.name)}</strong><small>${escapeHtml(source)}${game.status ? ` · ${escapeHtml(game.status)}` : ''}</small></span><kbd>↵</kbd></button>`;
    }).join('');
    results.querySelectorAll('.quick-launch-option').forEach((button, index) => {
      button.addEventListener('mouseenter', () => select(index));
      button.addEventListener('focus', () => select(index));
      button.addEventListener('click', () => close(false));
    });
  }

  function select(index) {
    const count = results.querySelectorAll('.quick-launch-option').length;
    if (!count) return;
    selectedIndex = (index + count) % count;
    results.querySelectorAll('.quick-launch-option').forEach((button, position) => {
      const selected = position === selectedIndex;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function open() {
    returnFocus = document.activeElement;
    backdrop.classList.remove('hidden');
    input.value = '';
    selectedIndex = 0;
    render();
    input.focus();
  }

  input.addEventListener('input', () => { selectedIndex = 0; render(); });
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isOpen()) close(); else open();
      return;
    }
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      const option = results.querySelectorAll('.quick-launch-option')[selectedIndex];
      if (option) {
        event.preventDefault();
        event.stopImmediatePropagation();
        option.click();
      }
    }
  }, true);
})();
