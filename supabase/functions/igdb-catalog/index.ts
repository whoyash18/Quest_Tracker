import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey || !authorization.startsWith('Bearer ')) {
    return json({ error: 'Sign in is required.' }, 401);
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Sign in is required.' }, 401);

  const clientId = Deno.env.get('IGDB_CLIENT_ID');
  const clientSecret = Deno.env.get('IGDB_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'IGDB credentials are not configured.' }, 503);

  let body: { year?: number; offset?: number; limit?: number };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const nowYear = new Date().getUTCFullYear();
  const year = Number(body.year);
  const offset = Math.max(0, Math.min(5000, Math.floor(Number(body.offset) || 0)));
  const limit = Math.max(1, Math.min(24, Math.floor(Number(body.limit) || 24)));
  if (!Number.isInteger(year) || year < 1970 || year > nowYear) return json({ error: 'Invalid year.' }, 400);

  try {
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    if (!tokenResponse.ok) throw new Error('Could not authenticate with IGDB.');
    const tokenData = await tokenResponse.json();
    const start = Math.floor(Date.UTC(year, 0, 1) / 1000);
    const end = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
    const query = `fields name,first_release_date,cover.image_id; where first_release_date >= ${start} & first_release_date < ${end}; sort first_release_date desc; limit ${limit}; offset ${offset};`;
    const gamesResponse = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'text/plain',
      },
      body: query,
    });
    if (!gamesResponse.ok) throw new Error('IGDB catalog request failed.');
    const games = await gamesResponse.json();
    return json({ games: games.map((game: { id: number; name: string; first_release_date?: number; cover?: { image_id?: string } }) => ({
      id: game.id,
      name: game.name,
      year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : year,
      image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : null,
    })) });
  } catch (error) {
    console.error('IGDB catalog request failed:', error);
    return json({ error: 'Could not load the IGDB catalog right now.' }, 502);
  }
});
