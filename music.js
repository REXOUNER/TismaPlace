(() => {
  const title = document.querySelector('#media-title');
  const subtitle = document.querySelector('#media-subtitle');
  const album = document.querySelector('#media-album');
  const source = document.querySelector('#media-source');
  const artwork = document.querySelector('#media-art');
  const fallbackArtwork = document.querySelector('#media-art-fallback');
  const previous = document.querySelector('#media-previous');
  const toggle = document.querySelector('#media-play-pause');
  const next = document.querySelector('#media-next');
  const volumeButton = document.querySelector('#media-volume-button');
  const volumePopover = document.querySelector('#media-volume-popover');
  const volumeSlider = document.querySelector('#media-volume-slider');
  const volumeValue = document.querySelector('#media-volume-value');
  const muteButton = document.querySelector('#media-volume-mute');
  const progress = document.querySelector('#media-progress');
  const progressBar = document.querySelector('#media-progress-bar');
  const positionLabel = document.querySelector('#media-position');
  const durationLabel = document.querySelector('#media-duration');
  let lastSession = null;
  let optimisticTimer = null;
  let volumeTimer = null;
  let timelinePosition = 0;
  let timelineDuration = 0;
  let timelineUpdatedAt = 0;
  let timelinePlaying = false;

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function updateProgress() {
    if (!timelineDuration) {
      progress.classList.add('hidden');
      return;
    }
    const elapsed = timelinePosition + (timelinePlaying ? Date.now() - timelineUpdatedAt : 0);
    const position = Math.min(timelineDuration, Math.max(0, elapsed));
    progress.classList.remove('hidden');
    progressBar.style.width = `${Math.min(100, position / timelineDuration * 100)}%`;
    positionLabel.textContent = formatTime(position);
    durationLabel.textContent = formatTime(timelineDuration);
  }

  function showState(session) {
    if (!session) {
      lastSession = null;
      title.textContent = 'Lecteur multimédia prêt';
      subtitle.textContent = 'Les commandes pilotent le lecteur audio actif de Windows.';
      album.textContent = '';
      source.innerHTML = '<i></i><span class="media-source-name">AUCUN LECTEUR ACTIF</span><b class="media-status-label">EN ATTENTE</b>';
      source.dataset.playing = 'false';
      artwork.removeAttribute('src');
      artwork.classList.add('hidden');
      fallbackArtwork.classList.remove('hidden');
      previous.disabled = true;
      toggle.disabled = true;
      next.disabled = true;
      toggle.textContent = '▶ LECTURE';
      timelinePosition = timelineDuration = 0;
      timelinePlaying = false;
      updateProgress();
      return;
    }
    lastSession = session;
    title.textContent = session.title || 'Titre inconnu';
    subtitle.textContent = session.artist || 'Artiste inconnu';
    album.textContent = session.albumTitle || '';
    const playing = session.playbackStatus === 'playing';
    const status = playing ? 'EN LECTURE' : session.playbackStatus === 'paused' ? 'EN PAUSE' : session.playbackStatus === 'stopped' ? 'ARRÊTÉ' : 'CONNECTÉ';
    source.innerHTML = `<i></i><span class="media-source-name">${escapeText(session.sourceApp || 'LECTEUR WINDOWS')}</span><b class="media-status-label">${status}</b>`;
    source.dataset.playing = String(playing);
    if (session.thumbnail) {
      artwork.src = session.thumbnail;
      artwork.classList.remove('hidden');
      fallbackArtwork.classList.add('hidden');
    } else {
      artwork.removeAttribute('src');
      artwork.classList.add('hidden');
      fallbackArtwork.classList.remove('hidden');
    }
    const capabilities = session.controls;
    previous.disabled = Boolean(capabilities && !capabilities.canSkipPrevious);
    next.disabled = Boolean(capabilities && !capabilities.canSkipNext);
    toggle.disabled = Boolean(capabilities && !(playing ? capabilities.canPause : capabilities.canPlay));
    toggle.textContent = playing ? '❚❚ PAUSE' : session.playbackStatus === 'paused' ? '▶ REPRENDRE' : '▶ LECTURE';
    toggle.title = playing ? 'Mettre en pause' : 'Reprendre la lecture';
    toggle.setAttribute('aria-label', toggle.title);
    const timeline = session.timeline || {};
    timelinePosition = Math.max(0, Number(timeline.positionMs) || 0);
    timelineDuration = Math.max(0, Number(timeline.durationMs) || 0);
    timelineUpdatedAt = Date.now();
    timelinePlaying = playing;
    updateProgress();
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function showVolume(state) {
    if (!state || state.unavailable) {
      volumeValue.textContent = 'INDISPONIBLE';
      volumeSlider.disabled = true;
      muteButton.disabled = true;
      volumeButton.title = state?.message || 'Le volume Windows est indisponible.';
      return;
    }
    const level = Math.max(0, Math.min(100, Number(state.level) || 0));
    volumeSlider.disabled = false;
    muteButton.disabled = false;
    volumeSlider.value = String(level);
    volumeValue.textContent = `${level}%`;
    muteButton.textContent = state.muted ? 'RÉACTIVER LE SON' : 'COUPER LE SON';
    muteButton.classList.toggle('is-muted', Boolean(state.muted));
    volumeButton.textContent = state.muted || level === 0 ? '🔇' : level < 35 ? '🔈' : '🔊';
  }

  artwork.addEventListener('error', () => {
    artwork.removeAttribute('src');
    artwork.classList.add('hidden');
    fallbackArtwork.classList.remove('hidden');
  });
  let progressTimer = null;
  function syncProgressTimer() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (!document.hidden) { updateProgress(); progressTimer = setInterval(updateProgress, 1000); }
  }
  document.addEventListener('visibilitychange', syncProgressTimer);
  syncProgressTimer();

  for (const [button, command] of [[previous, 'previous'], [toggle, 'playPause'], [next, 'next']]) {
    button.addEventListener('click', () => {
      if (command === 'playPause') {
        const wasPlaying = lastSession ? lastSession.playbackStatus === 'playing' : toggle.textContent.includes('PAUSE');
        toggle.textContent = wasPlaying ? '▶ REPRENDRE' : '❚❚ PAUSE';
        clearTimeout(optimisticTimer);
        optimisticTimer = setTimeout(() => {
          if (lastSession) showState(lastSession);
        }, 900);
      }
      window.arcade.mediaCommand(command).catch(() => toast('La commande multimédia n’a pas pu être envoyée.'));
    });
  }

  volumeButton.addEventListener('click', event => {
    event.stopPropagation();
    const opening = volumePopover.classList.contains('hidden');
    volumePopover.classList.toggle('hidden', !opening);
    volumeButton.setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.media-volume-control')) {
      volumePopover.classList.add('hidden');
      volumeButton.setAttribute('aria-expanded', 'false');
    }
  });
  volumeSlider.addEventListener('input', () => {
    const level = Number(volumeSlider.value);
    volumeValue.textContent = `${level}%`;
    volumeButton.textContent = level === 0 ? '🔇' : level < 35 ? '🔈' : '🔊';
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => window.arcade.setSystemVolume(level).catch(() => toast('Impossible de régler le volume Windows.')), 45);
  });
  muteButton.addEventListener('click', () => window.arcade.toggleSystemMute().catch(() => toast('Impossible de couper le son Windows.')));

  window.arcade.onMediaState(showState);
  window.arcade.getMediaState().then(showState).catch(() => showState(null));
  window.arcade.onSystemVolume(showVolume);
  window.arcade.getSystemVolume().then(showVolume).catch(() => showVolume({ unavailable: true }));
})();
