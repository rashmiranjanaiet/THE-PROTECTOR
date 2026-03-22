const state = {
  token: localStorage.getItem('tp_token') || '',
  user: null,
  aryanHistory: [],
  maps: {},
  layers: {},
  disasterMarkers: []
};

const OVERVIEW_SECTION_ID = 'section-overview';
const DETAIL_SECTION_IDS = [
  'section-flight',
  'section-isro',
  'section-news',
  'section-disaster',
  'section-secure',
  'section-relief',
  'section-cloud',
  'section-ai',
  'section-war'
];

const SECTION_LABELS = {
  'section-flight': '1. Flight Detailed Dashboard',
  'section-isro': '2. ISRO Detailed Dashboard',
  'section-news': '3. News Detailed Dashboard',
  'section-disaster': '4. Disaster Detailed Dashboard',
  'section-secure': '5. Secure Message Detailed Dashboard',
  'section-relief': '6. Relief Detailed Dashboard',
  'section-cloud': '7. Cloud Notes Detailed Dashboard',
  'section-ai': '8. Aryan AI Detailed Dashboard',
  'section-war': '9. Live War Detailed Dashboard'
};

const SECTION_MAP_IDS = {
  'section-flight': 'flightMap',
  'section-isro': 'isroMap',
  'section-disaster': 'disasterMap',
  'section-relief': 'reliefMap',
  'section-war': 'warMap'
};

const authView = document.getElementById('authView');
const appView = document.getElementById('appView');
const authStatus = document.getElementById('authStatus');
const notesStatus = document.getElementById('notesStatus');
const aryanStatus = document.getElementById('aryanStatus');

function setStatus(el, message, tone = 'warn') {
  if (!el) return;
  el.textContent = message || '';
  el.style.color = tone === 'ok' ? 'var(--ok)' : tone === 'error' ? 'var(--danger)' : 'var(--accent-2)';
}

function safeText(value) {
  return String(value ?? '').trim();
}

function setActiveNavigation(targetId) {
  document.querySelectorAll('.menu-btn[data-target], .quick-card[data-target]').forEach((node) => {
    node.classList.toggle('active-nav', node.dataset.target === targetId);
  });
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resetAuthForms() {
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
}

function showAuthMode(mode) {
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  const login = mode === 'login';
  loginTab.classList.toggle('active', login);
  registerTab.classList.toggle('active', !login);
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
  setStatus(authStatus, '');
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('tp_token', token);
}

function clearSession() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('tp_token');
}

async function api(path, options = {}, requireAuth = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (requireAuth && state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
      showAuth();
    }
    throw new Error(payload.error || payload.details || 'Request failed');
  }

  return payload;
}

function showAuth() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  appView.dataset.theme = OVERVIEW_SECTION_ID;
  document.getElementById('welcomeText').textContent = `Overview Dashboard | Welcome ${state.user?.username || 'Operator'}`;
}

function refreshMapForSection(sectionId) {
  const mapId = SECTION_MAP_IDS[sectionId];
  if (!mapId || !state.maps[mapId]) return;
  setTimeout(() => state.maps[mapId].invalidateSize(), 180);
}

function showOverviewDashboard() {
  const overview = document.getElementById(OVERVIEW_SECTION_ID);
  overview.classList.remove('hidden');
  DETAIL_SECTION_IDS.forEach((id) => {
    const section = document.getElementById(id);
    if (section) section.classList.add('hidden');
  });

  appView.dataset.theme = OVERVIEW_SECTION_ID;
  setActiveNavigation(OVERVIEW_SECTION_ID);
  document.getElementById('welcomeText').textContent = `Overview Dashboard | Welcome ${state.user?.username || 'Operator'}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDetailedDashboard(targetId) {
  if (targetId === OVERVIEW_SECTION_ID) {
    showOverviewDashboard();
    return;
  }

  const overview = document.getElementById(OVERVIEW_SECTION_ID);
  overview.classList.add('hidden');

  DETAIL_SECTION_IDS.forEach((id) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle('hidden', id !== targetId);
  });

  appView.dataset.theme = targetId;
  setActiveNavigation(targetId);
  document.getElementById('welcomeText').textContent = SECTION_LABELS[targetId] || 'Detailed Dashboard';
  const section = document.getElementById(targetId);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  refreshMapForSection(targetId);
}

function createMap(mapId, center = [20, 78], zoom = 3) {
  if (state.maps[mapId]) {
    return state.maps[mapId];
  }

  const map = L.map(mapId, {
    worldCopyJump: true
  }).setView(center, zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  state.maps[mapId] = map;
  state.layers[mapId] = L.layerGroup().addTo(map);
  return map;
}

function clearMapLayer(mapId) {
  if (!state.layers[mapId]) return;
  state.layers[mapId].clearLayers();
}

function renderMarkersOnMap(mapId, markers, popupBuilder) {
  const map = createMap(mapId);
  clearMapLayer(mapId);

  const valid = (markers || []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  valid.forEach((marker) => {
    const popup = popupBuilder ? popupBuilder(marker) : marker.title;
    L.marker([marker.lat, marker.lng]).addTo(state.layers[mapId]).bindPopup(popup || marker.title || 'Marker');
  });

  if (valid.length > 0) {
    const bounds = L.latLngBounds(valid.map((m) => [m.lat, m.lng]));
    map.fitBounds(bounds.pad(0.2), { maxZoom: 6 });
  }

  setTimeout(() => map.invalidateSize(), 120);
}

function clearContainer(id) {
  document.getElementById(id).innerHTML = '';
}

function card({ title, body = '', imageUrl = '', link = '', meta = '', css = 'feed-card' }) {
  const div = document.createElement('article');
  div.className = css;
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.loading = 'lazy';
    img.alt = title;
    div.appendChild(img);
  }
  const h4 = document.createElement('h4');
  h4.textContent = title || 'Untitled';
  div.appendChild(h4);

  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    div.appendChild(p);
  }

  if (meta) {
    const small = document.createElement('small');
    small.style.color = 'var(--muted)';
    small.textContent = meta;
    div.appendChild(small);
  }

  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = 'Open Source';
    div.appendChild(a);
  }
  return div;
}

async function loadFlight() {
  const data = await api('/api/feeds/flight');
  const markers = data.markers || [];

  document.getElementById('flightStats').textContent = `Source: ${data.source || 'unknown'} | Live points: ${markers.length}`;
  renderMarkersOnMap('flightMap', markers, (m) => `<b>${escapeHtml(m.title)}</b><br/>${escapeHtml(m.subtitle || '')}`);

  const container = document.getElementById('flightList');
  container.innerHTML = '';
  markers.slice(0, 40).forEach((m) => {
    container.appendChild(
      card({
        title: m.title || 'Flight',
        body: m.subtitle || '',
        meta: `${m.lat?.toFixed?.(2)}, ${m.lng?.toFixed?.(2)}`
      })
    );
  });
}

async function loadIsro() {
  const data = await api('/api/feeds/isro');
  const items = data.items || [];
  const mapMarkers = items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng));

  renderMarkersOnMap('isroMap', mapMarkers, (i) => `<b>${escapeHtml(i.title)}</b><br/>${escapeHtml(i.description || '')}`);

  const container = document.getElementById('isroList');
  container.innerHTML = '';
  items.slice(0, 60).forEach((item) => {
    container.appendChild(
      card({
        title: item.title,
        body: item.description,
        imageUrl: item.imageUrl || '',
        meta: `Source: ${item.source || data.source || 'ISRO'}`
      })
    );
  });
}

function renderNewsCards(containerId, list) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  list.forEach((item) => {
    container.appendChild(
      card({
        title: item.title,
        body: item.description,
        imageUrl: item.imageUrl || '',
        link: item.url,
        meta: `${item.source || 'News'} ${item.publishedAt ? `| ${new Date(item.publishedAt).toLocaleString()}` : ''}`,
        css: 'news-card'
      })
    );
  });
}

function renderVideoNewsCards(containerId, list) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  list.forEach((item) => {
    const box = document.createElement('article');
    box.className = 'news-card video-card';

    if (item.isPlayable && item.embedUrl) {
      if (item.videoType === 'youtube') {
        const iframe = document.createElement('iframe');
        iframe.src = item.embedUrl;
        iframe.title = item.title || 'Video';
        iframe.loading = 'lazy';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        box.appendChild(iframe);
      } else if (item.videoType === 'mp4') {
        const video = document.createElement('video');
        video.src = item.embedUrl;
        video.controls = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        box.appendChild(video);
      }
    } else if (item.imageUrl) {
      const img = document.createElement('img');
      img.src = item.imageUrl;
      img.loading = 'lazy';
      img.alt = item.title || 'News';
      box.appendChild(img);
    }

    const h4 = document.createElement('h4');
    h4.textContent = item.title || 'Video news';
    box.appendChild(h4);

    const meta = document.createElement('small');
    meta.style.color = 'var(--muted)';
    meta.textContent = `${item.source || 'News'} ${item.publishedAt ? `| ${new Date(item.publishedAt).toLocaleString()}` : ''}`;
    box.appendChild(meta);

    if (item.url) {
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = item.isPlayable ? 'Open original source' : 'Open story';
      box.appendChild(link);
    }

    container.appendChild(box);
  });
}

async function loadNews() {
  const data = await api('/api/feeds/news');
  renderNewsCards('globalNews', (data.global || []).slice(0, 15));
  renderNewsCards('indiaNews', (data.india || []).slice(0, 15));
  renderVideoNewsCards('videoNews', (data.videos || []).slice(0, 30));
  renderNewsCards('marketNews', (data.markets || []).slice(0, 15));
  renderNewsCards('warNews', (data.war || []).slice(0, 15));
}

function renderDisasterList(markers) {
  const container = document.getElementById('disasterList');
  container.innerHTML = '';
  markers.slice(0, 100).forEach((m) => {
    container.appendChild(
      card({
        title: m.title,
        body: m.category,
        meta: `${m.date ? new Date(m.date).toLocaleString() : ''}`
      })
    );
  });
}

function applyDisasterFilters() {
  const checked = [...document.querySelectorAll('.disaster-filter:checked')].map((el) => el.dataset.cat);
  const filtered = checked.length === 0
    ? state.disasterMarkers
    : state.disasterMarkers.filter((m) => {
        const categoryText = `${safeText(m.category)} ${safeText((m.categories || []).join(' '))}`.toLowerCase();
        return checked.some((cat) => {
          const c = cat.toLowerCase();
          if (c === 'wildfires') return categoryText.includes('wildfire');
          if (c === 'floods') return categoryText.includes('flood');
          if (c === 'severe storms') return categoryText.includes('storm') || categoryText.includes('cyclone') || categoryText.includes('hurricane') || categoryText.includes('typhoon');
          if (c === 'earthquakes') return categoryText.includes('earthquake');
          return categoryText.includes(c);
        });
      });

  renderMarkersOnMap('disasterMap', filtered, (m) => `<b>${escapeHtml(m.title)}</b><br/>${escapeHtml(m.category)}`);
  renderDisasterList(filtered);
}

async function loadDisasters() {
  const data = await api('/api/feeds/disasters');
  state.disasterMarkers = data.markers || [];
  applyDisasterFilters();
}

async function loadRelief() {
  const data = await api('/api/feeds/relief');
  const events = data.events || [];
  const markers = events
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .map((e) => ({ lat: e.lat, lng: e.lng, title: e.name, subtitle: e.type }));

  renderMarkersOnMap('reliefMap', markers, (m) => `<b>${escapeHtml(m.title)}</b><br/>${escapeHtml(m.subtitle || '')}`);

  const container = document.getElementById('reliefList');
  container.innerHTML = '';
  events.slice(0, 100).forEach((event) => {
    container.appendChild(
      card({
        title: event.name,
        body: `${event.type || 'Disaster'} | ${event.country || 'Unknown'}`,
        meta: `${event.status || ''} ${event.date ? `| ${new Date(event.date).toLocaleDateString()}` : ''}`,
        link: event.url
      })
    );
  });
}

async function loadWar() {
  const data = await api('/api/feeds/war');
  const markers = data.markers || [];
  renderMarkersOnMap('warMap', markers, (m) => `<b>${escapeHtml(m.title)}</b>`);

  const source = data.pageUrl || 'https://liveuamap.com';
  const sourceLink = document.getElementById('warSourceLink');
  sourceLink.href = source;
  sourceLink.textContent = source;

  const container = document.getElementById('warList');
  container.innerHTML = '';
  markers.slice(0, 120).forEach((event) => {
    container.appendChild(
      card({
        title: event.title || 'Conflict Update',
        meta: `${event.lat?.toFixed?.(2)}, ${event.lng?.toFixed?.(2)}`,
        link: event.url || ''
      })
    );
  });
}

function renderNotes(notes) {
  const container = document.getElementById('notesList');
  container.innerHTML = '';

  if (!notes.length) {
    container.appendChild(card({ title: 'No notes yet', body: 'Create your first cloud note.' }));
    return;
  }

  notes.forEach((note) => {
    const box = card({
      title: note.title,
      body: note.content,
      meta: `Updated: ${new Date(note.updatedAt).toLocaleString()}`
    });

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '0.4rem';
    row.style.marginTop = '0.4rem';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.onclick = async () => {
      const newTitle = prompt('Edit topic', note.title);
      if (newTitle === null) return;
      const newContent = prompt('Edit content', note.content);
      if (newContent === null) return;
      await api(`/api/notes/${note._id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: newTitle, content: newContent })
      });
      await loadNotes();
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      if (!confirm('Delete this note?')) return;
      await api(`/api/notes/${note._id}`, { method: 'DELETE' });
      await loadNotes();
    };

    row.appendChild(editBtn);
    row.appendChild(delBtn);
    box.appendChild(row);
    container.appendChild(box);
  });
}

async function loadNotes() {
  const data = await api('/api/notes');
  renderNotes(data.notes || []);
}

async function createSecureMessage(e) {
  e.preventDefault();
  const status = document.getElementById('secureCreateStatus');
  setStatus(status, 'Generating code...');

  const form = new FormData();
  form.append('message', document.getElementById('secureMessage').value);
  const file = document.getElementById('secureImage').files[0];
  if (file) form.append('image', file);
  const recipient = document.getElementById('secureRecipient').value.trim();
  if (recipient) form.append('recipientEmail', recipient);

  try {
    const data = await api('/api/secure/create', { method: 'POST', body: form });
    setStatus(
      status,
      `Code: ${data.code} | Expires: ${new Date(data.expiresAt).toLocaleString()}${data.emailed ? ' | emailed' : ''}`,
      'ok'
    );
    document.getElementById('createSecureForm').reset();
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

async function openSecureMessage(e) {
  e.preventDefault();
  const status = document.getElementById('secureOpenStatus');
  const resultBox = document.getElementById('secureOpenResult');
  setStatus(status, 'Opening code...');
  resultBox.innerHTML = '';

  const code = document.getElementById('secureCodeInput').value.trim();
  try {
    const data = await api('/api/secure/open', { method: 'POST', body: JSON.stringify({ code }) });
    setStatus(status, 'Code opened successfully (cannot be reused).', 'ok');
    resultBox.appendChild(card({ title: 'Decrypted Message', body: data.message || '' }));
    if (data.imageUrl) {
      const img = document.createElement('img');
      img.src = data.imageUrl;
      img.alt = 'Secure payload';
      img.style.maxWidth = '100%';
      img.style.marginTop = '0.6rem';
      img.style.borderRadius = '10px';
      resultBox.appendChild(img);
    }
  } catch (error) {
    setStatus(status, error.message, 'error');
  }
}

function appendAryanMessage(role, text) {
  const box = document.getElementById('aryanMessages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function speakText(text) {
  if (!document.getElementById('aryanSpeakToggle').checked) return;
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function sendAryanMessage() {
  const input = document.getElementById('aryanInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  appendAryanMessage('user', text);
  setStatus(aryanStatus, 'Aryan AI is thinking...');

  try {
    const data = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, history: state.aryanHistory })
    });

    const answer = data.text || 'No response from Aryan AI.';
    state.aryanHistory.push({ role: 'user', content: text });
    state.aryanHistory.push({ role: 'assistant', content: answer });
    state.aryanHistory = state.aryanHistory.slice(-16);
    appendAryanMessage('ai', answer);
    speakText(answer);
    setStatus(aryanStatus, '');
  } catch (error) {
    setStatus(aryanStatus, error.message, 'error');
  }
}

function setupVoiceInput() {
  const micBtn = document.getElementById('aryanMicBtn');
  const input = document.getElementById('aryanInput');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    micBtn.disabled = true;
    micBtn.textContent = 'Mic NA';
    return;
  }

  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;

  recognition.onstart = () => setStatus(aryanStatus, 'Listening...');
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || '';
    input.value = transcript;
    setStatus(aryanStatus, 'Voice captured.', 'ok');
  };
  recognition.onerror = () => setStatus(aryanStatus, 'Voice recognition failed.', 'error');
  recognition.onend = () => {
    if (aryanStatus.textContent === 'Listening...') setStatus(aryanStatus, '');
  };

  micBtn.onclick = () => recognition.start();
}

function bindNavigation() {
  document.querySelectorAll('.menu-btn[data-target], .quick-card[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const section = document.getElementById(targetId);
      if (section) {
        showDetailedDashboard(targetId);
      }
      document.getElementById('sideMenu').classList.add('hidden');
    });
  });

  document.getElementById('moreMenuBtn').addEventListener('click', () => {
    document.getElementById('sideMenu').classList.toggle('hidden');
  });
}

async function loadAllFeeds() {
  await Promise.allSettled([loadFlight(), loadIsro(), loadNews(), loadDisasters(), loadRelief(), loadWar()]);
}

async function bootAppAfterLogin() {
  showApp();
  bindNavigation();
  setupVoiceInput();
  showOverviewDashboard();

  document.getElementById('refreshAllBtn').onclick = async () => {
    await loadAllFeeds();
    await loadNotes();
  };

  document.getElementById('reloadFlightBtn').onclick = loadFlight;
  document.getElementById('reloadIsroBtn').onclick = loadIsro;
  document.getElementById('reloadNewsBtn').onclick = loadNews;
  document.getElementById('reloadDisasterBtn').onclick = loadDisasters;
  document.getElementById('reloadReliefBtn').onclick = loadRelief;
  document.getElementById('reloadWarBtn').onclick = loadWar;

  document.querySelectorAll('.disaster-filter').forEach((checkbox) => {
    checkbox.addEventListener('change', applyDisasterFilters);
  });

  document.getElementById('createSecureForm').addEventListener('submit', createSecureMessage);
  document.getElementById('openSecureForm').addEventListener('submit', openSecureMessage);

  document.getElementById('notesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    if (!title || !content) return;
    try {
      await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content }) });
      setStatus(notesStatus, 'Saved to cloud.', 'ok');
      document.getElementById('notesForm').reset();
      await loadNotes();
    } catch (error) {
      setStatus(notesStatus, error.message, 'error');
    }
  });

  document.getElementById('logoutBtn').onclick = () => {
    clearSession();
    location.reload();
  };

  document.getElementById('aryanFab').onclick = () => {
    document.getElementById('aryanPanel').classList.remove('hidden');
  };
  document.getElementById('closeAryanPanel').onclick = () => {
    document.getElementById('aryanPanel').classList.add('hidden');
  };
  document.getElementById('aryanSendBtn').onclick = sendAryanMessage;
  document.getElementById('aryanInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendAryanMessage();
    }
  });

  appendAryanMessage('ai', 'Aryan AI online. Ask for flight, disaster, war, or news intelligence.');

  await loadAllFeeds();
  await loadNotes();
  setInterval(loadAllFeeds, 4 * 60 * 1000);
}

function bindAuthEvents() {
  document.getElementById('loginTab').onclick = () => showAuthMode('login');
  document.getElementById('registerTab').onclick = () => showAuthMode('register');

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(authStatus, 'Signing in...');

    try {
      const identifier = document.getElementById('loginIdentifier').value.trim();
      const password = document.getElementById('loginPassword').value;
      const data = await api(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ identifier, password })
        },
        false
      );

      saveSession(data.token, data.user);
      setStatus(authStatus, 'Login successful.', 'ok');
      await bootAppAfterLogin();
    } catch (error) {
      setStatus(authStatus, error.message, 'error');
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(authStatus, 'Creating account...');

    try {
      const username = document.getElementById('registerUsername').value.trim();
      const email = document.getElementById('registerEmail').value.trim();
      const password = document.getElementById('registerPassword').value;

      const data = await api(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ username, email, password })
        },
        false
      );

      saveSession(data.token, data.user);
      setStatus(authStatus, 'Account created.', 'ok');
      await bootAppAfterLogin();
    } catch (error) {
      setStatus(authStatus, error.message, 'error');
    }
  });
}

async function bootstrap() {
  bindAuthEvents();
  showAuthMode('login');
  resetAuthForms();

  if (!state.token) {
    showAuth();
    return;
  }

  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    await bootAppAfterLogin();
  } catch {
    clearSession();
    showAuth();
  }
}

bootstrap();
