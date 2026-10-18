(() => {
  const cache = new Map();
  const panel = document.querySelector('#steam-achievements-panel');
  const content = document.querySelector('#steam-achievements-content');
  const refresh = document.querySelector('#steam-achievements-refresh');
  const escHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  async function load(game, force = false) {
    const isSteam = Boolean(game.steamAppId) || String(game.source || '').toLowerCase().includes('steam');
    panel.classList.toggle('hidden', !isSteam);
    if (!isSteam) return;
    if (!game.steamAppId) {
      refresh.disabled = true;
      content.innerHTML = '<p class="steam-achievements-message">Relance le scan de ta bibliothèque pour associer ce jeu à son identifiant Steam.</p>';
      return;
    }
    refresh.disabled = false;
    const cached = cache.get(String(game.id));
    if (!force && cached) {
      content.innerHTML = cached;
      return;
    }
    content.innerHTML = '<p class="steam-achievements-message"><span class="achievement-spinner"></span> Récupération des succès Steam…</p>';
    try {
      const result = await window.arcade.getSteamAchievements(game.steamAppId, force);
      if (String(detailsGameId) !== String(game.id) || document.querySelector('#details-modal').classList.contains('hidden')) return;
      const percent = result.total ? Math.round(result.unlocked / result.total * 100) : 0;
      const achievements = result.achievements || [];
      if (!result.total) {
        content.innerHTML = '<p class="steam-achievements-message">Ce jeu ne semble pas proposer de succès Steam.</p>';
        return;
      }
      content.innerHTML = `<div class="achievement-progress"><div class="achievement-progress-copy"><strong>${result.unlocked} <small>/ ${result.total}</small></strong><span>${percent}% débloqués</span></div><div class="achievement-progress-track"><i style="width:${percent}%"></i></div></div><div class="achievement-list">${achievements.map((item) => {
        const secret = item.hidden && !item.unlocked;
        const title = secret ? 'Succès secret' : item.name;
        const description = secret ? 'Ce succès est masqué jusqu’à son déblocage.' : item.description || (item.unlocked ? 'Succès débloqué.' : 'Description indisponible.');
        const icon = item.unlocked ? item.icon : (item.iconLocked || item.icon);
        const date = item.unlocked && item.unlockedAt ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(item.unlockedAt * 1000)) : '';
        return `<article class="achievement-item${item.unlocked ? ' unlocked' : ''}">${icon ? `<img src="${escHtml(icon)}" alt="" loading="lazy">` : '<span class="achievement-icon">✧</span>'}<span class="achievement-copy"><strong>${escHtml(title)}</strong><small>${escHtml(description)}</small></span><span class="achievement-state">${item.unlocked ? (date ? escHtml(date) : 'OBTENU') : 'VERROUILLÉ'}</span></article>`;
      }).join('')}</div>`;
      cache.set(String(game.id), content.innerHTML);
    } catch (error) {
      if (String(detailsGameId) !== String(game.id) || document.querySelector('#details-modal').classList.contains('hidden')) return;
      content.innerHTML = `<p class="steam-achievements-message error">${escHtml(error.message || 'Impossible de récupérer les succès Steam.')}</p>`;
    }
  }

  window.loadSteamAchievements = load;
  document.addEventListener('click', (event) => {
    if (event.target.closest('#steam-achievements-refresh')) {
      const game = games.find((item) => String(item.id) === String(detailsGameId));
      if (game) load(game, true);
    }
  });
})();
