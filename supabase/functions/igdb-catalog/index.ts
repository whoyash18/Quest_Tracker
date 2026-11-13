import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const majorPlatforms = '6, 167, 48, 49, 169, 130, 9, 8, 12, 11, 5, 41, 18, 19';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey || !authorization.startsWith('Bearer ')) return json({ error: 'Sign in is required.' }, 401);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Sign in is required.' }, 401);

  const clientId = Deno.env.get('IGDB_CLIENT_ID');
  const clientSecret = Deno.env.get('IGDB_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'IGDB credentials are not configured.' }, 503);

  let body: { mode?: string; query?: string; year?: number; offset?: number; limit?: number; id?: number };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    if (!tokenResponse.ok) {
      const reason = await tokenResponse.text();
      console.error('Twitch token request rejected:', tokenResponse.status, reason.slice(0, 300));
      return json({ error: 'Could not authenticate with IGDB.' }, 502);
    }
    const tokenData = await tokenResponse.json();
    const mode = body.mode || 'year';
    const offset = Math.max(0, Math.min(5000, Math.floor(Number(body.offset) || 0)));
    const limit = Math.max(1, Math.min(24, Math.floor(Number(body.limit) || 24)));
    const common = `game_type = 0 & platforms = (${majorPlatforms})`;

    if (mode === 'popular') {
      const popResponse = await fetch('https://api.igdb.com/v4/popularity_primitives', {
        method: 'POST',
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'text/plain' },
        body: 'fields game_id,value; where popularity_type = 1; sort value desc; limit 500;',
      });
      if (!popResponse.ok) throw new Error('IGDB popularity request failed.');
      const popularRows = await popResponse.json() as { game_id: number; value: number }[];
      const ids = Array.from(new Set(popularRows.map((row) => row.game_id))).filter((id) => Number.isInteger(id));
      if (!ids.length) return json({ games: [] });
      const popularGamesResponse = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'text/plain' },
        body: `fields id,name,slug,first_release_date,cover.image_id,total_rating; where id = (${ids.join(',')}) & ${common}; limit 500;`,
      });
      if (!popularGamesResponse.ok) throw new Error('IGDB popular games request failed.');
      const popularGames = await popularGamesResponse.json() as { id: number; name: string; slug?: string; first_release_date?: number; cover?: { image_id?: string }; total_rating?: number }[];
      const rank = new Map(ids.map((id, index) => [id, index]));
      popularGames.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      return json({ games: popularGames.slice(offset, offset + limit).map((game) => ({
        id: game.id,
        name: game.name,
        slug: game.slug || '',
        year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
        rating: game.total_rating || null,
        image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
      })) });
    }

    if (mode === 'details') {
      const id = Math.floor(Number(body.id));
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Invalid game ID.' }, 400);
      const response = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': clientId, Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'text/plain' },
        body: `fields name,summary,first_release_date,cover.image_id,genres.name; where id = ${id}; limit 1;`,
      });
      if (!response.ok) throw new Error('IGDB game details request failed.');
      const [game] = await response.json();
      if (!game) return json({ error: 'Game not found.' }, 404);
      return json({ game: {
        year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
        summary: game.summary || '',
        genres: (game.genres || []).map((genre: { name: string }) => genre.name),
        image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
      } });
    }

    let query = String(body.query || '').trim().replace(/["\\;]/g, '').slice(0, 100);
    let filter = common;
    let sort = 'rating_count desc';
    let search = '';
    if (mode === 'year') {
      const year = Number(body.year);
      const nowYear = new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < 1970 || year > nowYear) return json({ error: 'Invalid year.' }, 400);
      const start = Math.floor(Date.UTC(year, 0, 1) / 1000);
      const end = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
      filter += ` & first_release_date >= ${start} & first_release_date < ${end}`;
    } else if (mode === 'topRated') {
      filter += ' & rating_count > 20';
      sort = 'total_rating desc';
    } else if (mode === 'search') {
      if (query.length < 2) return json({ games: [] });
      search = `search "${query}"; `;
      sort = 'rating_count desc';
    } else return json({ error: 'Invalid catalog mode.' }, 400);

    const gamesResponse = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'text/plain' },
      body: `${search}fields id,name,slug,first_release_date,cover.image_id,total_rating,rating_count,hypes; where ${filter}; sort ${sort}; limit ${limit}; offset ${offset};`,
    });
    if (!gamesResponse.ok) throw new Error('IGDB catalog request failed.');
    const games = await gamesResponse.json();
    return json({ games: games.map((game: { id: number; name: string; slug?: string; first_release_date?: number; cover?: { image_id?: string }; total_rating?: number }) => ({
      id: game.id,
      name: game.name,
      slug: game.slug || '',
      year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
      rating: game.total_rating || null,
      image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
    })) });
  } catch (error) {
    console.error('IGDB catalog request failed:', error);
    return json({ error: 'Could not load the IGDB catalog right now.' }, 502);
  }
});
