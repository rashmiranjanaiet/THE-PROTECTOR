const cheerio = require('cheerio');
const { fetchJson } = require('../utils/http');

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function decodeHtmlEntities(text = '') {
  return String(text)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function getYouTubeVideoId(url = '') {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '') || null;
    }
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtube-nocookie.com')) {
      return parsed.searchParams.get('v') || null;
    }
  } catch {
    return null;
  }
  return null;
}

function getEmbeddableVideo(url = '') {
  const ytId = getYouTubeVideoId(url);
  if (ytId) {
    return {
      videoType: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1`,
      previewImage: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
    };
  }

  const low = String(url).toLowerCase();
  if (low.endsWith('.mp4') || low.includes('.mp4?')) {
    return {
      videoType: 'mp4',
      embedUrl: url,
      previewImage: null
    };
  }

  return {
    videoType: 'none',
    embedUrl: null,
    previewImage: null
  };
}

function collectCoordinatePairs(value, output = []) {
  if (!Array.isArray(value)) {
    return output;
  }

  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    output.push({ lng: value[0], lat: value[1] });
    return output;
  }

  for (const child of value) {
    collectCoordinatePairs(child, output);
  }
  return output;
}

function extractLatLngFromGeometry(geometry) {
  const pairs = collectCoordinatePairs(geometry?.coordinates, []);
  if (!pairs.length) {
    return { lat: null, lng: null };
  }

  const lat = pairs.reduce((sum, p) => sum + p.lat, 0) / pairs.length;
  const lng = pairs.reduce((sum, p) => sum + p.lng, 0) / pairs.length;
  return { lat, lng };
}

function normalizeArticle(article = {}, fallbackSource = 'Unknown') {
  return {
    title: article.title || 'Untitled',
    description: article.description || article.content || '',
    source: article.source?.name || article.source_id || fallbackSource,
    url: article.url || article.link || '',
    imageUrl: article.urlToImage || article.image_url || article.image || null,
    publishedAt: article.publishedAt || article.pubDate || article.published_at || null
  };
}

function normalizeVideoItem(item = {}, index = 0) {
  const url = item.video_url || item.link || item.url || '';
  const video = getEmbeddableVideo(url);
  return {
    id: item.video_id || item.article_id || `video-${index}`,
    title: item.title || 'News Video',
    url,
    imageUrl: item.image_url || item.image || video.previewImage || null,
    embedUrl: video.embedUrl,
    isPlayable: video.videoType !== 'none',
    videoType: video.videoType,
    source: item.source_id || item.source || 'NewsData',
    publishedAt: item.pubDate || item.published_at || null
  };
}

function normalizeCoordinateItem(item = {}, idx = 0, source = 'feed') {
  const lat = asNumber(
    item.lat ??
      item.latitude ??
      item.y ??
      item.geometry?.coordinates?.[1] ??
      item.coordinates?.[1] ??
      item.live?.latitude
  );

  const lng = asNumber(
    item.lng ??
      item.lon ??
      item.longitude ??
      item.x ??
      item.geometry?.coordinates?.[0] ??
      item.coordinates?.[0] ??
      item.live?.longitude
  );

  if (lat === null || lng === null) {
    return null;
  }

  return {
    id: item.id || item._id || `${source}-${idx}`,
    lat,
    lng,
    title: item.title || item.name || item.flight?.iata || item.flight?.icao || `${source} marker`,
    subtitle:
      item.description ||
      item.event ||
      item.flight_status ||
      item.category ||
      item.flight?.number ||
      '',
    source,
    raw: item
  };
}

async function tryFetchFlightFromConfiguredApi() {
  const apiUrl = process.env.FLIGHT_API_URL;
  const apiKey = process.env.FLIGHT_API_KEY;

  if (!apiUrl || !apiKey) {
    return [];
  }

  const url = new URL(apiUrl);
  if (!url.searchParams.get('access_key') && !url.searchParams.get('api_key') && !url.searchParams.get('apikey')) {
    url.searchParams.set('access_key', apiKey);
  }

  let payload;
  try {
    payload = await fetchJson(url.toString());
  } catch {
    const altUrl = new URL(apiUrl);
    altUrl.searchParams.set('api_key', apiKey);
    payload = await fetchJson(altUrl.toString());
  }

  const rawItems = safeArray(payload.data || payload.results || payload.flights || payload.items || payload.states || payload);

  return rawItems
    .map((item, idx) => normalizeCoordinateItem(item, idx, 'flight'))
    .filter(Boolean)
    .slice(0, 600);
}

async function tryFetchFlightFromOpenSky() {
  const payload = await fetchJson('https://opensky-network.org/api/states/all', {}, 20000);
  const states = safeArray(payload.states).slice(0, 600);

  return states
    .map((row, idx) => {
      const lat = asNumber(row?.[6]);
      const lng = asNumber(row?.[5]);
      if (lat === null || lng === null) {
        return null;
      }

      return {
        id: `os-${idx}`,
        lat,
        lng,
        title: row?.[1] || 'Aircraft',
        subtitle: `Velocity: ${Math.round(asNumber(row?.[9]) || 0)} m/s`,
        source: 'opensky',
        raw: row
      };
    })
    .filter(Boolean);
}

async function getFlightFeed() {
  try {
    const configured = await tryFetchFlightFromConfiguredApi();
    if (configured.length > 0) {
      return { source: 'configured', markers: configured };
    }
  } catch {
    // fallback below
  }

  try {
    const opensky = await tryFetchFlightFromOpenSky();
    return { source: 'opensky', markers: opensky };
  } catch (error) {
    return { source: 'none', markers: [], error: error.message };
  }
}

async function getIsroFeed() {
  const apiUrl = process.env.ISRO_API_URL;
  const apiKey = process.env.ISRO_API_KEY;

  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      if (apiKey && !url.searchParams.get('api_key') && !url.searchParams.get('access_key')) {
        url.searchParams.set('api_key', apiKey);
      }
      const payload = await fetchJson(url.toString());
      const rawItems = safeArray(payload.data || payload.results || payload.items || payload.events || payload);

      const items = rawItems.slice(0, 100).map((item, idx) => {
        const marker = normalizeCoordinateItem(item, idx, 'isro');
        return {
          id: marker?.id || `isro-${idx}`,
          title: item.title || item.name || `ISRO Event ${idx + 1}`,
          description: item.description || item.summary || '',
          imageUrl: item.image || item.imageUrl || item.thumbnail || null,
          lat: marker?.lat || null,
          lng: marker?.lng || null,
          source: 'isro-api',
          raw: item
        };
      });

      return { source: 'configured', items };
    } catch {
      // fallback to open feeds below
    }
  }

  try {
    const spacecrafts = await fetchJson('https://isro.vercel.app/api/spacecrafts');
    const list = safeArray(spacecrafts.spacecrafts).slice(0, 20).map((name, idx) => ({
      id: `isro-spacecraft-${idx}`,
      title: name,
      description: 'ISRO spacecraft catalog item.',
      imageUrl: null,
      lat: null,
      lng: null,
      source: 'isro-public'
    }));

    const eonet = await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30');
    const disasterItems = safeArray(eonet.events).map((event, idx) => {
      const geo = safeArray(event.geometry).at(-1);
      const lng = asNumber(geo?.coordinates?.[0]);
      const lat = asNumber(geo?.coordinates?.[1]);
      return {
        id: event.id || `isro-disaster-${idx}`,
        title: event.title,
        description: `${event.categories?.map((c) => c.title).join(', ') || 'Disaster event'} (NASA/EONET feed)`,
        imageUrl: null,
        lat,
        lng,
        source: 'nasa-eonet'
      };
    });

    return { source: 'fallback', items: [...list, ...disasterItems] };
  } catch (error) {
    return { source: 'none', items: [], error: error.message };
  }
}

async function fetchNewsApiTopHeadlines(country) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL('https://newsapi.org/v2/top-headlines');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('language', 'en');
  url.searchParams.set('pageSize', '25');

  if (country) {
    url.searchParams.set('country', country);
  }

  const payload = await fetchJson(url.toString(), {}, 20000);
  return safeArray(payload.articles).map((a) => normalizeArticle(a, 'NewsAPI'));
}

async function fetchNewsApiEverything(query) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '25');

  const payload = await fetchJson(url.toString(), {}, 20000);
  return safeArray(payload.articles).map((a) => normalizeArticle(a, 'NewsAPI'));
}

async function fetchNewsDataVideos() {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL('https://newsdata.io/api/1/latest');
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('language', 'en');
  url.searchParams.set('category', 'top,world,business');
  url.searchParams.set('size', '50');

  const payload = await fetchJson(url.toString(), {}, 20000);
  const results = safeArray(payload.results).map((item, idx) => normalizeVideoItem(item, idx));

  const preferred = results.filter((item) => item.url);
  return preferred;
}

async function fetchYouTubeFeedVideos({ channelId, sourceName, limit = 2 }) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const response = await fetch(feedUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const xml = await response.text();
  if (!response.ok || !xml.includes('<entry>')) {
    return [];
  }

  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.slice(0, limit).map((entry, idx) => {
    const videoId =
      entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ||
      entry.match(/<id>yt:video:([^<]+)<\/id>/)?.[1] ||
      '';
    const title = decodeHtmlEntities(entry.match(/<title>([^<]+)<\/title>/)?.[1] || 'News Video');
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] || null;

    return {
      id: `${channelId}-${idx}`,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      imageUrl: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
      embedUrl: videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1` : null,
      isPlayable: Boolean(videoId),
      videoType: 'youtube',
      source: sourceName,
      publishedAt
    };
  });
}

async function fetchCuratedNewsVideos() {
  const channels = [
    { channelId: 'UCCj956IF62FbT7Gouszaj9w', sourceName: 'BBC News' },
    { channelId: 'UCupvZG-5ko_eiXAupbDfxWw', sourceName: 'CNN' },
    { channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', sourceName: 'Al Jazeera English' },
    { channelId: 'UCYPvAwZP8pZhSMW8qs7cVCw', sourceName: 'India Today' },
    { channelId: 'UCt4t-jeY85JegMlZ-E5UWtA', sourceName: 'Aaj Tak' },
    { channelId: 'UCZFMm1mMw0F81Z37aaEzTUA', sourceName: 'NDTV' }
  ];

  const settled = await Promise.allSettled(channels.map((channel) => fetchYouTubeFeedVideos({ ...channel, limit: 2 })));
  const videos = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .filter((item) => item.isPlayable);

  return uniqueBy(videos, (item) => item.url || item.id).slice(0, 12);
}

async function getNewsFeed() {
  const [globalHeadlines, indiaHeadlines, businessNews, warNews, videoItems, curatedVideoItems] = await Promise.allSettled([
    fetchNewsApiTopHeadlines('us'),
    fetchNewsApiTopHeadlines('in'),
    fetchNewsApiEverything('stock market OR finance OR economy'),
    fetchNewsApiEverything('war OR conflict OR defense'),
    fetchNewsDataVideos(),
    fetchCuratedNewsVideos()
  ]);

  const global = globalHeadlines.status === 'fulfilled' ? globalHeadlines.value.slice(0, 15) : [];
  const india = indiaHeadlines.status === 'fulfilled' ? indiaHeadlines.value.slice(0, 15) : [];
  const markets = businessNews.status === 'fulfilled' ? businessNews.value.slice(0, 15) : [];
  const war = warNews.status === 'fulfilled' ? warNews.value.slice(0, 15) : [];

  let videos = videoItems.status === 'fulfilled' ? videoItems.value : [];
  const curatedVideos = curatedVideoItems.status === 'fulfilled' ? curatedVideoItems.value : [];

  if (videos.length < 30) {
    const combinedArticles = uniqueBy([...global, ...india, ...markets, ...war], (item) => item.url || item.title);
    const articleAsVideo = combinedArticles.map((item, idx) => ({
      id: `article-video-${idx}`,
      title: item.title,
      url: item.url,
      imageUrl: item.imageUrl,
      embedUrl: null,
      isPlayable: false,
      videoType: 'none',
      source: item.source,
      publishedAt: item.publishedAt
    }));

    videos = uniqueBy([...curatedVideos, ...videos, ...articleAsVideo], (item) => item.url || item.title).slice(0, 30);
  } else {
    videos = uniqueBy([...curatedVideos, ...videos], (item) => item.url || item.title).slice(0, 30);
  }

  return { global, india, videos, markets, war };
}

async function getEonetDisasters() {
  const payload = await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200', {}, 25000);
  const events = safeArray(payload.events);

  const markers = events
    .map((event, idx) => {
      const latestGeometry = safeArray(event.geometry).at(-1);
      const { lat, lng } = extractLatLngFromGeometry(latestGeometry);

      if (lat === null || lng === null) {
        return null;
      }

      return {
        id: event.id || `eonet-${idx}`,
        lat,
        lng,
        title: event.title,
        category: event.categories?.[0]?.title || 'Unknown',
        categories: safeArray(event.categories).map((c) => c.title),
        geometryType: latestGeometry?.type || 'Unknown',
        date: latestGeometry?.date || null,
        source: 'EONET'
      };
    })
    .filter(Boolean);

  return markers;
}

async function getReliefDisasters() {
  const url = new URL('https://api.reliefweb.int/v1/disasters');
  url.searchParams.set('appname', 'the-protector');
  url.searchParams.set('profile', 'full');
  url.searchParams.set('limit', '100');
  url.searchParams.set('sort[]', 'date:desc');

  const payload = await fetchJson(url.toString(), {}, 25000);
  const data = safeArray(payload.data);

  return data.map((row, idx) => {
    const fields = row.fields || {};
    const lat = asNumber(fields.primary_country?.location?.lat);
    const lng = asNumber(fields.primary_country?.location?.lon);

    return {
      id: row.id || `relief-${idx}`,
      name: fields.name || 'Disaster',
      type: safeArray(fields.type).map((t) => t.name).join(', '),
      country: fields.primary_country?.name || 'Unknown',
      status: fields.status || 'Unknown',
      date: fields.date?.created || null,
      lat,
      lng,
      url: fields.url || ''
    };
  });
}

function parseWarMarkersFromHtml(html) {
  const markers = [];
  const $ = cheerio.load(html);

  $('[data-lat][data-lng]').each((idx, el) => {
    const lat = asNumber($(el).attr('data-lat'));
    const lng = asNumber($(el).attr('data-lng'));
    if (lat !== null && lng !== null) {
      markers.push({
        id: `war-data-${idx}`,
        lat,
        lng,
        title: $(el).attr('data-title') || $(el).find('h3,h4').first().text().trim() || 'Live conflict update',
        source: 'liveuamap'
      });
    }
  });

  const regex = /\"lat\"\\s*:\\s*\"?(-?\\d+\\.?\\d*)\"?\\s*,\\s*\"lng\"\\s*:\\s*\"?(-?\\d+\\.?\\d*)\"?(?:[^\\n]{0,260}?\"(?:title|name)\"\\s*:\\s*\"([^\"]+)\")?/g;
  let match;
  let idx = markers.length;
  while ((match = regex.exec(html)) !== null) {
    markers.push({
      id: `war-js-${idx++}`,
      lat: Number(match[1]),
      lng: Number(match[2]),
      title: match[3] || 'Live conflict update',
      source: 'liveuamap'
    });
  }

  return uniqueBy(markers, (m) => `${m.lat},${m.lng},${m.title}`).slice(0, 300);
}

async function fetchWarFeedFromAjax(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const endpoint = `${origin}/ajax/do?act=prevday&id=0`;

  const payload = await fetchJson(
    endpoint,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-requested-with': 'XMLHttpRequest',
        referer: `${origin}/`
      }
    },
    25000
  );

  const venues = safeArray(payload.venues);
  const markers = [];

  for (const venue of venues) {
    const mainLat = asNumber(venue.lat);
    const mainLng = asNumber(venue.lng);
    if (mainLat !== null && mainLng !== null) {
      markers.push({
        id: `war-venue-${venue.id}`,
        lat: mainLat,
        lng: mainLng,
        title: venue.name || 'Live conflict update',
        source: 'liveuamap',
        url: venue.link || venue.source || ''
      });
    }

    for (const point of safeArray(venue.points)) {
      const lat = asNumber(point.lat);
      const lng = asNumber(point.lng);
      if (lat === null || lng === null) {
        continue;
      }
      markers.push({
        id: `war-point-${venue.id}-${point.id || `${lat}-${lng}`}`,
        lat,
        lng,
        title: venue.name || 'Conflict point',
        source: 'liveuamap',
        url: venue.link || venue.source || ''
      });
    }
  }

  return uniqueBy(markers, (item) => `${item.lat},${item.lng},${item.title}`).slice(0, 500);
}

async function getWarFeed() {
  const url = process.env.LIVE_WAR_URL || 'https://liveuamap.com';

  try {
    let markers = [];
    try {
      markers = await fetchWarFeedFromAjax(url);
    } catch {
      markers = [];
    }

    if (markers.length > 0) {
      return {
        source: 'liveuamap-ajax',
        pageUrl: url,
        markers
      };
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    markers = parseWarMarkersFromHtml(html);

    return {
      source: 'liveuamap-html',
      pageUrl: url,
      markers
    };
  } catch (error) {
    return {
      source: 'none',
      pageUrl: url,
      markers: [],
      error: error.message
    };
  }
}

module.exports = {
  getFlightFeed,
  getIsroFeed,
  getNewsFeed,
  getEonetDisasters,
  getReliefDisasters,
  getWarFeed
};
