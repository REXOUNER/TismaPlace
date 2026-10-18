(() => {
  const presets = {
    immersion: {
      label: 'Immersion',
      widgets: { music: true, continue: true, feature: true, stats: true },
      order: ['hero', 'music', 'continue', 'library'],
    },
    focus: {
      label: 'Focus',
      widgets: { music: false, continue: true, feature: false, stats: true },
      order: ['library', 'continue', 'hero', 'music'],
    },
    compact: {
      label: 'Compact',
      widgets: { music: true, continue: false, feature: false, stats: false },
      order: ['music', 'library', 'continue', 'hero'],
    },
  };

  const widgetInputs = {
    music: '#home-music-toggle',
    continue: '#home-continue-toggle',
    feature: '#home-feature-toggle',
    stats: '#home-stats-toggle',
  };

  function selectedPreset() {
    const saved = localStorage.getItem('tisma-home-preset');
    return Object.hasOwn(presets, saved) ? saved : (saved === 'custom' ? 'custom' : 'immersion');
  }

  function updatePresetSelection() {
    const current = selectedPreset();
    document.querySelectorAll('[data-home-preset]').forEach((button) => {
      const active = button.dataset.homePreset === current;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const status = document.querySelector('#home-preset-status');
    if (status) {
      status.textContent = current === 'custom'
        ? 'PERSONNALISATION ACTIVE · tes réglages manuels sont conservés'
        : `PRÉRÉGLAGE ACTIF · ${presets[current].label.toUpperCase()}`;
    }
  }

  function applyPreset(key) {
    const preset = presets[key];
    if (!preset) return;

    for (const [widget, visible] of Object.entries(preset.widgets)) {
      localStorage.setItem(`tisma-home-${widget}`, visible ? 'on' : 'off');
      const input = document.querySelector(widgetInputs[widget]);
      if (input) input.checked = visible;
    }

    localStorage.setItem('tisma-home-order', JSON.stringify(preset.order));
    localStorage.setItem('tisma-home-preset', key);
    document.body.classList.toggle('home-preset-compact', key === 'compact');
    document.body.classList.toggle('home-preset-focus', key === 'focus');
    applyHomeWidgetPreferences();
    renderHomeOrderControls();
    updatePresetSelection();
    window.dispatchEvent(new CustomEvent('tisma-home-preset-changed', { detail: { key } }));
    const toast = document.querySelector('#toast');
    if (toast) {
      toast.textContent = `Accueil ${preset.label.toLowerCase()} activé.`;
      toast.classList.add('show');
      clearTimeout(window.tismaPresetToastTimer);
      window.tismaPresetToastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
    }
  }

  function useCustomLayout() {
    localStorage.setItem('tisma-home-preset', 'custom');
    document.body.classList.remove('home-preset-compact');
    document.body.classList.remove('home-preset-focus');
    updatePresetSelection();
  }

  document.addEventListener('click', (event) => {
    const presetButton = event.target.closest('[data-home-preset]');
    if (presetButton) {
      applyPreset(presetButton.dataset.homePreset);
      return;
    }
    if (event.target.closest('[data-home-move]')) useCustomLayout();
    if (event.target.closest('#settings-btn, #profile-btn')) queueMicrotask(updatePresetSelection);
  });

  document.addEventListener('change', (event) => {
    if (Object.values(widgetInputs).some((selector) => event.target.matches(selector))) useCustomLayout();
  });

  const savedPreset = selectedPreset();
  document.body.classList.toggle('home-preset-compact', savedPreset === 'compact');
  document.body.classList.toggle('home-preset-focus', savedPreset === 'focus');
  updatePresetSelection();
})();
