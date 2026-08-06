/**
 * AI PULSE — CLIENT APPLICATION ENGINE
 */

(function () {
  'use strict';

  // --- STATE MANAGEMENT ---
  const state = {
    allArticles: [],
    filteredArticles: [],
    globalFeeds: [],
    disabledFeedIds: JSON.parse(localStorage.getItem('aipulse_disabled_feeds') || '[]'),
    customFeeds: JSON.parse(localStorage.getItem('aipulse_custom_feeds') || '[]'),
    bookmarks: JSON.parse(localStorage.getItem('aipulse_bookmarks') || '[]'),
    readArticles: JSON.parse(localStorage.getItem('aipulse_read') || '[]'),
    
    // Filters
    activeLang: 'all',
    activeCategory: 'all',
    searchQuery: '',
    viewMode: localStorage.getItem('aipulse_view') || 'grid',
    updatedAt: null
  };

  // --- DOM ELEMENTS ---
  const DOM = {
    heroSection: document.getElementById('heroSection'),
    heroGrid: document.getElementById('heroGrid'),
    newsGrid: document.getElementById('newsGrid'),
    feedTitle: document.getElementById('feedTitle'),
    emptyState: document.getElementById('emptyState'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    articlesCount: document.getElementById('articlesCount'),
    lastUpdatedText: document.getElementById('lastUpdatedText'),
    bookmarkCount: document.getElementById('bookmarkCount'),
    
    // Filters
    langChips: document.querySelectorAll('.lang-filters .filter-chip'),
    categoryChips: document.querySelectorAll('.category-filters .filter-chip'),
    viewGridBtn: document.getElementById('viewGridBtn'),
    viewListBtn: document.getElementById('viewListBtn'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    btnRefresh: document.getElementById('btnRefresh'),
    
    // Modal
    feedsModal: document.getElementById('feedsModal'),
    btnManageFeeds: document.getElementById('btnManageFeeds'),
    footerManageFeeds: document.getElementById('footerManageFeeds'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    btnSaveFeeds: document.getElementById('btnSaveFeeds'),
    modalTabs: document.querySelectorAll('.modal-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    globalFeedsList: document.getElementById('globalFeedsList'),
    customFeedsList: document.getElementById('customFeedsList'),
    addFeedForm: document.getElementById('addFeedForm'),
    btnExportSettings: document.getElementById('btnExportSettings'),
    importSettingsFile: document.getElementById('importSettingsFile'),
    btnResetAll: document.getElementById('btnResetAll'),
    
    toastContainer: document.getElementById('toastContainer')
  };

  // --- INITIALIZATION ---
  async function init() {
    setupEventListeners();
    updateBookmarkCounter();
    
    try {
      await Promise.all([loadGlobalFeedsConfig(), loadNewsData()]);
      if (state.customFeeds.length > 0) {
        await fetchCustomFeedsClientSide();
      }
      render();
    } catch (err) {
      console.error('Erro ao inicializar app:', err);
      showToast('Erro ao carregar notícias. Tente atualizar a página.', 'error');
    }
  }

  // --- DATA FETCHING ---
  async function loadGlobalFeedsConfig() {
    try {
      const res = await fetch('feeds.json');
      if (res.ok) {
        state.globalFeeds = await res.json();
      }
    } catch (e) {
      console.warn('Não foi possível carregar feeds.json:', e);
    }
  }

  async function loadNewsData() {
    const res = await fetch(`data/news.json?t=${Date.now()}`);
    if (!res.ok) throw new Error('Não foi possível obter news.json');
    const data = await res.json();
    state.updatedAt = data.updatedAt;
    state.allArticles = data.articles || [];
    
    updateLastUpdatedLabel();
  }

  // Real-time client-side fetch for user's custom RSS feeds via CORS proxy
  async function fetchCustomFeedsClientSide() {
    const customArticles = [];
    for (const feed of state.customFeeds) {
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(feed.url)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) continue;
        const data = await res.json();
        
        if (data.contents) {
          const parser = new DOMParser();
          const xml = parser.parseFromString(data.contents, 'text/xml');
          const items = xml.querySelectorAll('item, entry');
          
          items.forEach((item, index) => {
            if (index > 10) return; // Limitar por feed customizado
            const title = item.querySelector('title')?.textContent || 'Sem título';
            const link = item.querySelector('link')?.textContent || item.querySelector('link')?.getAttribute('href') || '#';
            const description = item.querySelector('description, summary, content')?.textContent || '';
            const pubDate = item.querySelector('pubDate, updated, published')?.textContent || new Date().toISOString();
            
            const dateObj = new Date(pubDate);
            const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
            
            const cleanSnippet = description.replace(/<[^>]+>/g, '').slice(0, 250);

            customArticles.push({
              id: btoa(link).replace(/=/g, '').slice(-20),
              title: title.trim(),
              link: link.trim(),
              snippet: cleanSnippet + (cleanSnippet.length >= 250 ? '...' : ''),
              pubDate: validDate.toISOString(),
              timestamp: validDate.getTime(),
              sourceId: feed.id,
              sourceName: feed.name,
              sourceIcon: feed.icon || '📌',
              category: feed.category || 'news',
              lang: feed.lang || 'pt',
              imageUrl: null,
              readingTime: '2 min read'
            });
          });
        }
      } catch (err) {
        console.warn(`Erro ao buscar feed customizado ${feed.name}:`, err);
      }
    }

    if (customArticles.length > 0) {
      // Mesclar e deduplicar
      const combined = [...customArticles, ...state.allArticles];
      const seen = new Set();
      state.allArticles = combined.filter(art => {
        if (seen.has(art.link)) return false;
        seen.add(art.link);
        return true;
      }).sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  // --- FILTERING & RENDER ENGINE ---
  function applyFilters() {
    let list = [...state.allArticles];

    // 1. Filtrar Feeds Desativados
    if (state.disabledFeedIds.length > 0) {
      list = list.filter(art => !state.disabledFeedIds.includes(art.sourceId));
    }

    // 2. Filtro de Idioma
    if (state.activeLang !== 'all') {
      list = list.filter(art => art.lang === state.activeLang);
    }

    // 3. Filtro de Categoria
    if (state.activeCategory === 'bookmarks') {
      list = list.filter(art => state.bookmarks.includes(art.id));
    } else if (state.activeCategory !== 'all') {
      list = list.filter(art => art.category === state.activeCategory);
    }

    // 4. Filtro de Busca
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(art => 
        art.title.toLowerCase().includes(q) ||
        art.snippet.toLowerCase().includes(q) ||
        art.sourceName.toLowerCase().includes(q)
      );
    }

    state.filteredArticles = list;
  }

  function render() {
    applyFilters();
    renderHero();
    renderNewsGrid();
    updateMetrics();
  }

  function renderHero() {
    if (state.activeCategory === 'bookmarks' || state.searchQuery.trim() !== '' || state.filteredArticles.length < 3) {
      DOM.heroSection.style.display = 'none';
      return;
    }

    DOM.heroSection.style.display = 'block';
    const top3 = state.filteredArticles.slice(0, 3);
    
    DOM.heroGrid.innerHTML = top3.map(art => {
      const bgStyle = art.imageUrl ? `style="background-image: url('${art.imageUrl}')"` : '';
      const isBookmarked = state.bookmarks.includes(art.id);
      
      return `
        <a href="${art.link}" target="_blank" rel="noopener" class="hero-card" data-id="${art.id}">
          <div class="hero-bg" ${bgStyle}></div>
          <div class="hero-overlay"></div>
          <div class="hero-content">
            <div class="news-meta">
              <span class="source-tag">${art.sourceIcon} ${art.sourceName}</span>
              <span class="time-tag">${formatTimeAgo(art.pubDate)}</span>
            </div>
            <h3 class="hero-title">${escapeHtml(art.title)}</h3>
          </div>
        </a>
      `;
    }).join('');
  }

  function renderNewsGrid() {
    DOM.newsGrid.className = `news-grid view-${state.viewMode}`;

    // Desconsiderar as 3 primeiras se estiver no Hero
    const isHeroVisible = DOM.heroSection.style.display !== 'none';
    const displayList = isHeroVisible ? state.filteredArticles.slice(3) : state.filteredArticles;

    if (displayList.length === 0) {
      DOM.newsGrid.style.display = 'none';
      DOM.emptyState.hidden = false;
      return;
    }

    DOM.newsGrid.style.display = 'grid';
    DOM.emptyState.hidden = true;

    DOM.newsGrid.innerHTML = displayList.map(art => {
      const isRead = state.readArticles.includes(art.id);
      const isBookmarked = state.bookmarks.includes(art.id);
      
      const thumbHtml = art.imageUrl
        ? `<div class="news-thumb" style="background-image: url('${art.imageUrl}')"></div>`
        : `<div class="news-thumb-fallback">${art.sourceIcon}</div>`;

      return `
        <article class="news-card ${isRead ? 'read' : ''}" data-id="${art.id}">
          ${state.viewMode === 'grid' ? thumbHtml : ''}
          <div class="news-body">
            <div class="news-meta">
              <span class="source-tag">${art.sourceIcon} ${art.sourceName}</span>
              <span class="time-tag">${formatTimeAgo(art.pubDate)} • ${art.readingTime}</span>
            </div>
            <h3 class="card-title">
              <a href="${art.link}" target="_blank" rel="noopener" class="article-link">${escapeHtml(art.title)}</a>
            </h3>
            <p class="card-snippet">${escapeHtml(art.snippet)}</p>
            
            <div class="card-footer">
              <span class="lang-badge">${art.lang === 'pt' ? '🇧🇷 PT' : '🇺🇸 EN'}</span>
              <div class="card-actions">
                <button class="action-btn toggle-read-btn" title="${isRead ? 'Marcar como não lido' : 'Marcar como lido'}">
                  ${isRead ? '✅' : '👁️'}
                </button>
                <button class="action-btn toggle-bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" title="Salvar nos Favoritos">
                  ${isBookmarked ? '⭐' : '🔖'}
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function updateMetrics() {
    DOM.articlesCount.textContent = `Exibindo ${state.filteredArticles.length} de ${state.allArticles.length} notícias`;
  }

  function updateBookmarkCounter() {
    DOM.bookmarkCount.textContent = state.bookmarks.length;
  }

  function updateLastUpdatedLabel() {
    if (!state.updatedAt) return;
    DOM.lastUpdatedText.textContent = `Atualizado ${formatTimeAgo(state.updatedAt)}`;
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Busca
    DOM.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      DOM.clearSearchBtn.hidden = state.searchQuery.trim() === '';
      render();
    });

    DOM.clearSearchBtn.addEventListener('click', () => {
      DOM.searchInput.value = '';
      state.searchQuery = '';
      DOM.clearSearchBtn.hidden = true;
      render();
    });

    // Atalhos de Teclado (Ctrl+K ou /)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        DOM.searchInput.focus();
      }
    });

    // Filtros de Idioma
    DOM.langChips.forEach(chip => {
      chip.addEventListener('click', () => {
        DOM.langChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeLang = chip.dataset.lang;
        render();
      });
    });

    // Filtros de Categoria
    DOM.categoryChips.forEach(chip => {
      chip.addEventListener('click', () => {
        DOM.categoryChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeCategory = chip.dataset.category;
        
        DOM.feedTitle.textContent = chip.dataset.category === 'bookmarks'
          ? 'Artigos Salvos (Favoritos)'
          : 'Notícias Filtradas';
          
        render();
      });
    });

    // Modos de Visão (Grid vs Lista)
    DOM.viewGridBtn.addEventListener('click', () => {
      state.viewMode = 'grid';
      localStorage.setItem('aipulse_view', 'grid');
      DOM.viewGridBtn.classList.add('active');
      DOM.viewListBtn.classList.remove('active');
      render();
    });

    DOM.viewListBtn.addEventListener('click', () => {
      state.viewMode = 'list';
      localStorage.setItem('aipulse_view', 'list');
      DOM.viewListBtn.classList.add('active');
      DOM.viewGridBtn.classList.remove('active');
      render();
    });

    DOM.btnResetFilters.addEventListener('click', () => {
      state.searchQuery = '';
      state.activeLang = 'all';
      state.activeCategory = 'all';
      DOM.searchInput.value = '';
      DOM.langChips.forEach(c => c.classList.toggle('active', c.dataset.lang === 'all'));
      DOM.categoryChips.forEach(c => c.classList.toggle('active', c.dataset.category === 'all'));
      render();
    });

    DOM.btnRefresh.addEventListener('click', async () => {
      showToast('Atualizando dados...');
      await loadNewsData();
      render();
    });

    // Interações com Cartões (Delegado no newsGrid)
    DOM.newsGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.news-card');
      if (!card) return;
      const articleId = card.dataset.id;

      // Clique em Marcar como Lido
      if (e.target.closest('.toggle-read-btn')) {
        e.preventDefault();
        toggleReadState(articleId);
        return;
      }

      // Clique em Bookmark
      if (e.target.closest('.toggle-bookmark-btn')) {
        e.preventDefault();
        toggleBookmarkState(articleId);
        return;
      }

      // Se clicar no link do artigo, marcar automaticamente como lido
      if (e.target.closest('.article-link')) {
        if (!state.readArticles.includes(articleId)) {
          state.readArticles.push(articleId);
          localStorage.setItem('aipulse_read', JSON.stringify(state.readArticles));
        }
      }
    });

    // Modal de Feeds
    const openModal = () => {
      renderModalFeedsList();
      DOM.feedsModal.hidden = false;
    };
    DOM.btnManageFeeds.addEventListener('click', openModal);
    DOM.footerManageFeeds.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
    DOM.btnCloseModal.addEventListener('click', () => { DOM.feedsModal.hidden = true; });
    DOM.btnSaveFeeds.addEventListener('click', () => {
      DOM.feedsModal.hidden = true;
      render();
      showToast('Configurações salvas!');
    });
    DOM.feedsModal.addEventListener('click', (e) => {
      if (e.target === DOM.feedsModal) {
        DOM.feedsModal.hidden = true;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !DOM.feedsModal.hidden) {
        DOM.feedsModal.hidden = true;
      }
    });


    // Tabs da Modal
    DOM.modalTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        DOM.modalTabs.forEach(t => t.classList.remove('active'));
        DOM.tabPanes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab${capitalize(tab.dataset.tab)}`).classList.add('active');
      });
    });

    // Formulário Adicionar Feed Customizado
    DOM.addFeedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('feedUrlInput').value.trim();
      const name = document.getElementById('feedNameInput').value.trim();
      const lang = document.getElementById('feedLangSelect').value;

      if (!url || !name) return;

      const newFeed = {
        id: `custom_${Date.now()}`,
        name: name,
        url: url,
        category: 'news',
        lang: lang,
        icon: '📌'
      };

      state.customFeeds.push(newFeed);
      localStorage.setItem('aipulse_custom_feeds', JSON.stringify(state.customFeeds));
      DOM.addFeedForm.reset();
      renderModalFeedsList();
      showToast(`Feed "${name}" adicionado com sucesso!`);
    });

    // Exportar / Importar
    DOM.btnExportSettings.addEventListener('click', exportSettingsJson);
    DOM.importSettingsFile.addEventListener('change', importSettingsJson);
    DOM.btnResetAll.addEventListener('click', () => {
      if (confirm('Deseja realmente restaurar todas as configurações e limpar os feeds salvos?')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  // --- ACTIONS & HELPERS ---
  function toggleReadState(id) {
    const index = state.readArticles.indexOf(id);
    if (index > -1) {
      state.readArticles.splice(index, 1);
    } else {
      state.readArticles.push(id);
    }
    localStorage.setItem('aipulse_read', JSON.stringify(state.readArticles));
    renderNewsGrid();
  }

  function toggleBookmarkState(id) {
    const index = state.bookmarks.indexOf(id);
    if (index > -1) {
      state.bookmarks.splice(index, 1);
      showToast('Removido dos salvos');
    } else {
      state.bookmarks.push(id);
      showToast('Artigo salvo nos favoritos! 🔖');
    }
    localStorage.setItem('aipulse_bookmarks', JSON.stringify(state.bookmarks));
    updateBookmarkCounter();
    renderNewsGrid();
  }

  function renderModalFeedsList() {
    // 1. Feeds Globais
    DOM.globalFeedsList.innerHTML = state.globalFeeds.map(feed => {
      const isDisabled = state.disabledFeedIds.includes(feed.id);
      return `
        <div class="feed-item">
          <div class="feed-info">
            <span>${feed.icon}</span>
            <div>
              <strong>${feed.name}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${feed.url}</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" data-feed-id="${feed.id}" ${!isDisabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
    }).join('');

    // Listener para os toggles dos feeds globais
    DOM.globalFeedsList.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const feedId = e.target.dataset.feedId;
        if (e.target.checked) {
          state.disabledFeedIds = state.disabledFeedIds.filter(id => id !== feedId);
        } else {
          if (!state.disabledFeedIds.includes(feedId)) state.disabledFeedIds.push(feedId);
        }
        localStorage.setItem('aipulse_disabled_feeds', JSON.stringify(state.disabledFeedIds));
      });
    });

    // 2. Feeds Customizados
    if (state.customFeeds.length === 0) {
      DOM.customFeedsList.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhum feed customizado adicionado.</p>';
      return;
    }

    DOM.customFeedsList.innerHTML = state.customFeeds.map((feed, idx) => `
      <div class="feed-item">
        <div class="feed-info">
          <span>${feed.icon}</span>
          <div>
            <strong>${feed.name}</strong>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${feed.url}</div>
          </div>
        </div>
        <button class="btn btn-danger btn-remove-custom" data-idx="${idx}">Excluir</button>
      </div>
    `).join('');

    DOM.customFeedsList.querySelectorAll('.btn-remove-custom').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        state.customFeeds.splice(idx, 1);
        localStorage.setItem('aipulse_custom_feeds', JSON.stringify(state.customFeeds));
        renderModalFeedsList();
        showToast('Feed customizado removido.');
      });
    });
  }

  function exportSettingsJson() {
    const data = {
      disabledFeedIds: state.disabledFeedIds,
      customFeeds: state.customFeeds,
      bookmarks: state.bookmarks,
      readArticles: state.readArticles,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aipulse_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSettingsJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.disabledFeedIds) localStorage.setItem('aipulse_disabled_feeds', JSON.stringify(data.disabledFeedIds));
        if (data.customFeeds) localStorage.setItem('aipulse_custom_feeds', JSON.stringify(data.customFeeds));
        if (data.bookmarks) localStorage.setItem('aipulse_bookmarks', JSON.stringify(data.bookmarks));
        if (data.readArticles) localStorage.setItem('aipulse_read', JSON.stringify(data.readArticles));
        showToast('Configurações importadas com sucesso!');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast('Erro ao importar arquivo JSON inválido.', 'error');
      }
    };
    reader.readAsText(file);
  }

  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'agora mesmo';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.floor(hours / 24);
    return `há ${days} d`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Inicializar quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
