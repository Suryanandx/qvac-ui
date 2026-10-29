// Built-in connectors. Each declares its credential fields, a connection test
// and tools. `write: true` tools change data in the outside service and always
// ask for approval. Responses are trimmed before the model sees them.
import { z } from 'zod';
import { basic, bearer, httpsOrigin, request, ConnectorError } from './http.mjs';

const text = (max = 300) => z.string().trim().min(1).max(max);
const limit = z.number().int().min(1).max(25).default(10);
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj?.[k] !== undefined && obj?.[k] !== null).map(k => [k, obj[k]]));
const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const google = (c, path, opts = {}) => request(opts.method || 'GET', `https://www.googleapis.com${path}`, { ...opts, headers: bearer(c.token()) });
const graph = (c, path, opts = {}) => request(opts.method || 'GET', `https://graph.microsoft.com/v1.0${path}`, { ...opts, headers: bearer(c.token()) });

export const CONNECTORS = [
  // ── Search & web ────────────────────────────────────────────────────────
  { id: 'wikipedia', name: 'Wikipedia', group: 'Search & web', fields: [], description: 'Encyclopedia search and article summaries. No key needed.',
    test: c => c.call('wikipedia_search', { query: 'Ada Lovelace', limit: 1 }),
    tools: [
      { name: 'wikipedia_search', description: 'Search Wikipedia articles.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => (await request('GET', 'https://en.wikipedia.org/w/api.php', { ...c.opts, query: { action: 'query', list: 'search', srsearch: query, srlimit: limit, format: 'json' } })).query.search.map(r => ({ title: r.title, snippet: strip(r.snippet) })) },
      { name: 'wikipedia_summary', description: 'Get the summary of one Wikipedia article by title.', schema: z.object({ title: text(200) }),
        run: async ({ title }, c) => pick(await request('GET', `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, c.opts), ['title', 'description', 'extract']) }
    ] },
  { id: 'weather', name: 'Weather', group: 'Search & web', fields: [], description: 'Forecasts from Open-Meteo. No key needed.',
    test: c => c.call('weather_forecast', { place: 'London', days: 1 }),
    tools: [
      { name: 'weather_forecast', description: 'Daily weather forecast for a place name.', schema: z.object({ place: text(100), days: z.number().int().min(1).max(7).default(3) }),
        run: async ({ place, days }, c) => {
          const geo = (await request('GET', 'https://geocoding-api.open-meteo.com/v1/search', { ...c.opts, query: { name: place, count: 1 } })).results?.[0];
          if (!geo) throw new ConnectorError(`No place called ${place}`);
          const f = await request('GET', 'https://api.open-meteo.com/v1/forecast', { ...c.opts, query: { latitude: geo.latitude, longitude: geo.longitude, daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code', timezone: 'auto', forecast_days: days } });
          return { place: `${geo.name}, ${geo.country}`, days: f.daily.time.map((d, i) => ({ date: d, maxC: f.daily.temperature_2m_max[i], minC: f.daily.temperature_2m_min[i], rainChance: f.daily.precipitation_probability_max[i] })) };
        } }
    ] },
  { id: 'hackernews', name: 'Hacker News', group: 'Search & web', fields: [], description: 'Search tech news and discussions on Hacker News. No key needed.',
    test: c => c.call('hackernews_search', { query: 'local AI', limit: 1 }),
    tools: [
      { name: 'hackernews_search', description: 'Search Hacker News stories by topic, newest first.', schema: z.object({ query: text(200), limit }),
        run: async ({ query, limit }, c) => ((await request('GET', 'https://hn.algolia.com/api/v1/search_by_date', { ...c.opts, query: { query, tags: 'story', hitsPerPage: limit } })).hits || []).map(h => ({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points, comments: h.num_comments, date: h.created_at?.slice(0, 10) })) },
      { name: 'hackernews_front_page', description: 'Current Hacker News front page stories.', schema: z.object({ limit }),
        run: async ({ limit }, c) => ((await request('GET', 'https://hn.algolia.com/api/v1/search', { ...c.opts, query: { tags: 'front_page', hitsPerPage: limit } })).hits || []).map(h => ({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points, comments: h.num_comments })) }
    ] },
  { id: 'brave', name: 'Brave Search', group: 'Search & web', fields: [{ key: 'apiKey', label: 'API key', secret: true, help: 'api-dashboard.search.brave.com' }], description: 'Web search with an independent index.',
    test: c => c.call('brave_web_search', { query: 'test', limit: 1 }),
    tools: [
      { name: 'brave_web_search', description: 'Search the web.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await request('GET', 'https://api.search.brave.com/res/v1/web/search', { ...c.opts, headers: { 'X-Subscription-Token': c.get('apiKey') }, query: { q: query, count: limit } })).web?.results || []).map(r => ({ title: r.title, url: r.url, snippet: strip(r.description) })) }
    ] },
  { id: 'tavily', name: 'Tavily', group: 'Search & web', fields: [{ key: 'apiKey', label: 'API key', secret: true, help: 'app.tavily.com' }], description: 'Search built for AI agents, with a summarized answer.',
    test: c => c.call('tavily_search', { query: 'test', limit: 1 }),
    tools: [
      { name: 'tavily_search', description: 'Search the web and get a short answer with sources.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => { const r = await request('POST', 'https://api.tavily.com/search', { ...c.opts, headers: bearer(c.get('apiKey')), body: { query, max_results: limit, include_answer: true } }); return { answer: r.answer, results: (r.results || []).map(x => ({ title: x.title, url: x.url, content: String(x.content || '').slice(0, 400) })) }; } }
    ] },
  { id: 'exa', name: 'Exa', group: 'Search & web', fields: [{ key: 'apiKey', label: 'API key', secret: true, help: 'dashboard.exa.ai' }], description: 'Neural web search that returns page text.',
    test: c => c.call('exa_search', { query: 'test', limit: 1 }),
    tools: [
      { name: 'exa_search', description: 'Search the web by meaning and return page excerpts.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await request('POST', 'https://api.exa.ai/search', { ...c.opts, headers: { 'x-api-key': c.get('apiKey') }, body: { query, numResults: limit, contents: { text: { maxCharacters: 600 } } } })).results || []).map(r => ({ title: r.title, url: r.url, text: r.text })) }
    ] },
  { id: 'firecrawl', name: 'Firecrawl', group: 'Search & web', fields: [{ key: 'apiKey', label: 'API key', secret: true, help: 'firecrawl.dev/app' }], description: 'Turn any web page into clean Markdown.',
    test: c => c.call('firecrawl_scrape', { url: 'https://example.com' }),
    tools: [
      { name: 'firecrawl_scrape', description: 'Fetch a web page as Markdown text.', schema: z.object({ url: z.string().url().max(2000) }),
        run: async ({ url }, c) => { const r = await request('POST', 'https://api.firecrawl.dev/v2/scrape', { ...c.opts, headers: bearer(c.get('apiKey')), body: { url, formats: ['markdown'], onlyMainContent: true } }); return { url, title: r.data?.metadata?.title, markdown: String(r.data?.markdown || '').slice(0, 8000) }; } }
    ] },

  // ── Work & docs ─────────────────────────────────────────────────────────
  { id: 'google', name: 'Google Workspace', group: 'Work & docs', oauth: 'google', description: 'Gmail, Calendar and Drive. Uses your own Google OAuth client (Desktop app type).',
    fields: [{ key: 'clientId', label: 'OAuth client ID' }, { key: 'clientSecret', label: 'OAuth client secret', secret: true }],
    test: c => c.call('gmail_search', { query: 'newer_than:7d', limit: 1 }),
    tools: [
      { name: 'gmail_search', description: 'Search Gmail with Gmail search syntax (e.g. from:alex newer_than:7d).', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => {
          const list = await google(c, '/gmail/v1/users/me/messages', { ...c.opts, query: { q: query, maxResults: limit } });
          return Promise.all((list.messages || []).map(async m => { const d = await google(c, `/gmail/v1/users/me/messages/${m.id}`, { ...c.opts, query: { format: 'metadata', metadataHeaders: 'From' } }); const h = Object.fromEntries((d.payload?.headers || []).map(x => [x.name, x.value])); return { id: m.id, from: h.From, snippet: strip(d.snippet) }; }));
        } },
      { name: 'gmail_create_draft', write: true, description: 'Create (not send) a Gmail draft.', schema: z.object({ to: z.string().email(), subject: text(200), body: text(8000) }),
        run: async ({ to, subject, body }, c) => { const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`).toString('base64url'); const r = await google(c, '/gmail/v1/users/me/drafts', { ...c.opts, method: 'POST', body: { message: { raw } } }); return { draftId: r.id, status: 'Draft saved; not sent.' }; } },
      { name: 'calendar_upcoming', description: 'List upcoming Google Calendar events.', schema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
        run: async ({ days }, c) => ((await google(c, '/calendar/v3/calendars/primary/events', { ...c.opts, query: { timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + days * 864e5).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 25 } })).items || []).map(e => ({ title: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, location: e.location })) },
      { name: 'calendar_create_event', write: true, description: 'Create a Google Calendar event.', schema: z.object({ title: text(200), start: z.string().describe('ISO 8601 start time'), end: z.string().describe('ISO 8601 end time'), description: z.string().max(2000).optional() }),
        run: async ({ title, start, end, description }, c) => pick(await google(c, '/calendar/v3/calendars/primary/events', { ...c.opts, method: 'POST', body: { summary: title, description, start: { dateTime: start }, end: { dateTime: end } } }), ['id', 'htmlLink', 'status']) },
      { name: 'drive_search', description: 'Search Google Drive files by name or content.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await google(c, '/drive/v3/files', { ...c.opts, query: { q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`, pageSize: limit, fields: 'files(id,name,mimeType,modifiedTime)' } })).files || []) },
      { name: 'drive_read_file', description: 'Read the text of a Google Doc or text file in Drive by file id.', schema: z.object({ fileId: text(100) }),
        run: async ({ fileId }, c) => { const meta = await google(c, `/drive/v3/files/${encodeURIComponent(fileId)}`, { ...c.opts, query: { fields: 'name,mimeType' } }); const path = meta.mimeType?.startsWith('application/vnd.google-apps') ? `/drive/v3/files/${encodeURIComponent(fileId)}/export` : `/drive/v3/files/${encodeURIComponent(fileId)}`; const body = await google(c, path, { ...c.opts, query: meta.mimeType?.startsWith('application/vnd.google-apps') ? { mimeType: 'text/plain' } : { alt: 'media' } }); return { name: meta.name, text: String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 8000) }; } }
    ] },
  { id: 'microsoft', name: 'Microsoft 365', group: 'Work & docs', oauth: 'microsoft', description: 'Outlook mail, calendar and OneDrive. Uses your own Entra app registration (public client).',
    fields: [{ key: 'clientId', label: 'Application (client) ID' }, { key: 'tenant', label: 'Tenant', placeholder: 'common' }],
    test: c => c.call('outlook_search', { query: 'meeting', limit: 1 }),
    tools: [
      { name: 'outlook_search', description: 'Search Outlook mail.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await graph(c, '/me/messages', { ...c.opts, query: { $search: `"${query.replace(/"/g, '')}"`, $top: limit, $select: 'subject,from,receivedDateTime,bodyPreview' } })).value || []).map(m => ({ subject: m.subject, from: m.from?.emailAddress?.address, received: m.receivedDateTime, preview: m.bodyPreview })) },
      { name: 'outlook_calendar', description: 'List upcoming Outlook calendar events.', schema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
        run: async ({ days }, c) => ((await graph(c, '/me/calendarView', { ...c.opts, query: { startDateTime: new Date().toISOString(), endDateTime: new Date(Date.now() + days * 864e5).toISOString(), $top: 25, $select: 'subject,start,end,location' } })).value || []).map(e => ({ title: e.subject, start: e.start?.dateTime, end: e.end?.dateTime, location: e.location?.displayName })) },
      { name: 'onedrive_search', description: 'Search OneDrive files.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await graph(c, `/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, ''))}')`, { ...c.opts, query: { $top: limit, $select: 'id,name,webUrl,lastModifiedDateTime' } })).value || []) },
      { name: 'outlook_create_draft', write: true, description: 'Create (not send) an Outlook draft email.', schema: z.object({ to: z.string().email(), subject: text(200), body: text(8000) }),
        run: async ({ to, subject, body }, c) => pick(await graph(c, '/me/messages', { ...c.opts, method: 'POST', body: { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] } }), ['id', 'webLink']) }
    ] },
  { id: 'notion', name: 'Notion', group: 'Work & docs', fields: [{ key: 'token', label: 'Internal integration secret', secret: true, help: 'notion.so/my-integrations, then share pages with it' }], description: 'Search and read pages shared with your integration.',
    test: c => c.call('notion_search', { query: '', limit: 1 }),
    tools: [
      { name: 'notion_search', description: 'Search Notion pages and databases.', schema: z.object({ query: z.string().max(200).default(''), limit }),
        run: async ({ query, limit }, c) => ((await request('POST', 'https://api.notion.com/v1/search', { ...c.opts, headers: { ...bearer(c.get('token')), 'Notion-Version': '2022-06-28' }, body: { query, page_size: limit } })).results || []).map(r => ({ id: r.id, type: r.object, url: r.url, title: (Object.values(r.properties || {}).find(p => p.type === 'title')?.title || r.title || []).map(t => t.plain_text).join('') })) },
      { name: 'notion_read_page', description: 'Read the text content of a Notion page by id.', schema: z.object({ pageId: text(100) }),
        run: async ({ pageId }, c) => ({ text: ((await request('GET', `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children`, { ...c.opts, headers: { ...bearer(c.get('token')), 'Notion-Version': '2022-06-28' }, query: { page_size: 100 } })).results || []).map(b => (b[b.type]?.rich_text || []).map(t => t.plain_text).join('')).filter(Boolean).join('\n').slice(0, 8000) }) },
      { name: 'notion_append_text', write: true, description: 'Append a paragraph of text to a Notion page.', schema: z.object({ pageId: text(100), text: text(2000) }),
        run: async ({ pageId, text: content }, c) => { await request('PATCH', `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children`, { ...c.opts, headers: { ...bearer(c.get('token')), 'Notion-Version': '2022-06-28' }, body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }] } }); return { status: 'Appended' }; } }
    ] },
  { id: 'slack', name: 'Slack', group: 'Work & docs', fields: [{ key: 'token', label: 'Bot token (xoxb-…)', secret: true, help: 'api.slack.com/apps → OAuth & Permissions' }], description: 'Read channels and post messages as your bot.',
    test: c => c.call('slack_channels', { limit: 1 }),
    tools: [
      { name: 'slack_channels', description: 'List Slack channels the bot can see.', schema: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
        run: async ({ limit }, c) => { const r = await request('GET', 'https://slack.com/api/conversations.list', { ...c.opts, headers: bearer(c.get('token')), query: { limit, exclude_archived: true } }); if (!r.ok) throw new ConnectorError(`Slack: ${r.error}`); return r.channels.map(ch => ({ id: ch.id, name: ch.name, members: ch.num_members })); } },
      { name: 'slack_channel_history', description: 'Read recent messages from a Slack channel id.', schema: z.object({ channel: text(40), limit }),
        run: async ({ channel, limit }, c) => { const r = await request('GET', 'https://slack.com/api/conversations.history', { ...c.opts, headers: bearer(c.get('token')), query: { channel, limit } }); if (!r.ok) throw new ConnectorError(`Slack: ${r.error}`); return r.messages.map(m => ({ user: m.user, text: m.text, ts: m.ts })); } },
      { name: 'slack_post_message', write: true, description: 'Post a message to a Slack channel.', schema: z.object({ channel: text(40), text: text(4000) }),
        run: async ({ channel, text: msg }, c) => { const r = await request('POST', 'https://slack.com/api/chat.postMessage', { ...c.opts, headers: bearer(c.get('token')), body: { channel, text: msg } }); if (!r.ok) throw new ConnectorError(`Slack: ${r.error}`); return { status: 'Posted', ts: r.ts }; } }
    ] },

  // ── Dev & projects ──────────────────────────────────────────────────────
  { id: 'github', name: 'GitHub', group: 'Dev & projects', fields: [{ key: 'token', label: 'Personal access token', secret: true, help: 'github.com/settings/tokens (fine-grained)' }], description: 'Issues, pull requests, repositories and files.',
    test: c => request('GET', 'https://api.github.com/user', { ...c.opts, headers: { ...bearer(c.get('token')), 'X-GitHub-Api-Version': '2022-11-28' } }).then(u => ({ login: u.login })),
    tools: [
      { name: 'github_search_issues', description: 'Search GitHub issues and pull requests (GitHub search syntax, e.g. repo:owner/name is:open bug).', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => ((await request('GET', 'https://api.github.com/search/issues', { ...c.opts, headers: { ...bearer(c.get('token')), 'X-GitHub-Api-Version': '2022-11-28' }, query: { q: query, per_page: limit } })).items || []).map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, repo: i.repository_url?.split('/').slice(-2).join('/'), pr: Boolean(i.pull_request) })) },
      { name: 'github_read_file', description: 'Read a file from a GitHub repository.', schema: z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), path: text(500), ref: z.string().max(100).optional() }),
        run: async ({ repo, path, ref }, c) => { const f = await request('GET', `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { ...c.opts, headers: { ...bearer(c.get('token')), 'X-GitHub-Api-Version': '2022-11-28' }, query: { ref } }); if (Array.isArray(f)) return { directory: f.map(x => ({ name: x.name, type: x.type })) }; return { path: f.path, text: Buffer.from(f.content || '', 'base64').toString('utf8').slice(0, 8000) }; } },
      { name: 'github_my_pull_requests', description: 'List open pull requests authored by or awaiting review from you.', schema: z.object({ limit }),
        run: async ({ limit }, c) => ((await request('GET', 'https://api.github.com/search/issues', { ...c.opts, headers: { ...bearer(c.get('token')), 'X-GitHub-Api-Version': '2022-11-28' }, query: { q: 'is:pr is:open involves:@me', per_page: limit } })).items || []).map(i => ({ title: i.title, url: i.html_url, updated: i.updated_at })) },
      { name: 'github_create_issue', write: true, description: 'Open a new GitHub issue.', schema: z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), title: text(250), body: z.string().max(10000).default('') }),
        run: async ({ repo, title, body }, c) => pick(await request('POST', `https://api.github.com/repos/${repo}/issues`, { ...c.opts, headers: { ...bearer(c.get('token')), 'X-GitHub-Api-Version': '2022-11-28' }, body: { title, body } }), ['number', 'html_url']) }
    ] },
  { id: 'linear', name: 'Linear', group: 'Dev & projects', fields: [{ key: 'apiKey', label: 'Personal API key', secret: true, help: 'linear.app → Settings → Security & access' }], description: 'Issues, teams and projects.',
    test: c => c.gql('{ viewer { name } }'),
    gql: (c, query, variables) => request('POST', 'https://api.linear.app/graphql', { ...c.opts, headers: { Authorization: c.get('apiKey') }, body: { query, variables } }).then(r => { if (r.errors?.length) throw new ConnectorError(`Linear: ${r.errors[0].message}`); return r.data; }),
    tools: [
      { name: 'linear_my_issues', description: 'List issues assigned to you.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await c.gql('query($n:Int){ viewer { assignedIssues(first:$n, filter:{ state:{ type:{ nin:["completed","canceled"] } } }) { nodes { identifier title state { name } priority url } } } }', { n: limit })).viewer.assignedIssues.nodes.map(i => ({ id: i.identifier, title: i.title, state: i.state.name, priority: i.priority, url: i.url })) },
      { name: 'linear_search_issues', description: 'Search Linear issues by text.', schema: z.object({ query: text(), limit }),
        run: async ({ query, limit }, c) => (await c.gql('query($q:String!,$n:Int){ searchIssues(term:$q, first:$n) { nodes { identifier title state { name } url } } }', { q: query, n: limit })).searchIssues.nodes.map(i => ({ id: i.identifier, title: i.title, state: i.state.name, url: i.url })) },
      { name: 'linear_teams', description: 'List Linear teams and their ids.', schema: z.object({}),
        run: async (_, c) => (await c.gql('{ teams { nodes { id key name } } }')).teams.nodes },
      { name: 'linear_create_issue', write: true, description: 'Create a Linear issue in a team (use linear_teams for the team id).', schema: z.object({ teamId: text(60), title: text(250), description: z.string().max(10000).optional() }),
        run: async (input, c) => (await c.gql('mutation($i:IssueCreateInput!){ issueCreate(input:$i){ issue { identifier url } } }', { i: input })).issueCreate.issue }
    ] },
  { id: 'jira', name: 'Jira', group: 'Dev & projects', fields: [{ key: 'site', label: 'Site', placeholder: 'your-team.atlassian.net' }, { key: 'email', label: 'Account email' }, { key: 'token', label: 'API token', secret: true, help: 'id.atlassian.com/manage-profile/security/api-tokens' }], description: 'Jira Cloud issues with JQL.',
    test: c => request('GET', `${httpsOrigin(c.get('site'), { suffix: '.atlassian.net' })}/rest/api/3/myself`, { ...c.opts, headers: basic(c.get('email'), c.get('token')) }).then(u => ({ user: u.displayName })),
    tools: [
      { name: 'jira_search', description: 'Search Jira issues with JQL (e.g. assignee = currentUser() AND statusCategory != Done).', schema: z.object({ jql: text(1000), limit }),
        run: async ({ jql, limit }, c) => ((await request('POST', `${httpsOrigin(c.get('site'), { suffix: '.atlassian.net' })}/rest/api/3/search/jql`, { ...c.opts, headers: basic(c.get('email'), c.get('token')), body: { jql, maxResults: limit, fields: ['summary', 'status', 'assignee', 'priority'] } })).issues || []).map(i => ({ key: i.key, summary: i.fields.summary, status: i.fields.status?.name, assignee: i.fields.assignee?.displayName, priority: i.fields.priority?.name })) },
      { name: 'jira_add_comment', write: true, description: 'Add a comment to a Jira issue.', schema: z.object({ issueKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/), text: text(5000) }),
        run: async ({ issueKey, text: comment }, c) => pick(await request('POST', `${httpsOrigin(c.get('site'), { suffix: '.atlassian.net' })}/rest/api/3/issue/${issueKey}/comment`, { ...c.opts, headers: basic(c.get('email'), c.get('token')), body: { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] } } }), ['id', 'created']) }
    ] },
  { id: 'gitlab', name: 'GitLab', group: 'Dev & projects', fields: [{ key: 'host', label: 'Host', placeholder: 'gitlab.com' }, { key: 'token', label: 'Personal access token', secret: true }], description: 'Issues and merge requests on GitLab.com or self-hosted.',
    test: c => request('GET', `${httpsOrigin(c.get('host') || 'gitlab.com')}/api/v4/user`, { ...c.opts, headers: bearer(c.get('token')) }).then(u => ({ user: u.username })),
    tools: [
      { name: 'gitlab_my_issues', description: 'List open GitLab issues assigned to you.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await request('GET', `${httpsOrigin(c.get('host') || 'gitlab.com')}/api/v4/issues`, { ...c.opts, headers: bearer(c.get('token')), query: { scope: 'assigned_to_me', state: 'opened', per_page: limit } })).map(i => ({ title: i.title, url: i.web_url, project: i.references?.full })) },
      { name: 'gitlab_my_merge_requests', description: 'List open merge requests you authored.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await request('GET', `${httpsOrigin(c.get('host') || 'gitlab.com')}/api/v4/merge_requests`, { ...c.opts, headers: bearer(c.get('token')), query: { scope: 'created_by_me', state: 'opened', per_page: limit } })).map(m => ({ title: m.title, url: m.web_url, status: m.detailed_merge_status })) }
    ] },
  { id: 'sentry', name: 'Sentry', group: 'Dev & projects', fields: [{ key: 'org', label: 'Organization slug' }, { key: 'token', label: 'Auth token', secret: true }, { key: 'host', label: 'Host', placeholder: 'sentry.io' }], description: 'Unresolved errors across your projects.',
    test: c => c.call('sentry_issues', { limit: 1 }),
    tools: [
      { name: 'sentry_issues', description: 'List the most frequent unresolved Sentry issues.', schema: z.object({ limit, query: z.string().max(200).default('is:unresolved') }),
        run: async ({ limit, query }, c) => (await request('GET', `${httpsOrigin(c.get('host') || 'sentry.io')}/api/0/organizations/${encodeURIComponent(c.get('org'))}/issues/`, { ...c.opts, headers: bearer(c.get('token')), query: { query, limit, sort: 'freq' } })).map(i => ({ title: i.title, culprit: i.culprit, count: i.count, users: i.userCount, url: i.permalink, project: i.project?.slug })) }
    ] },

  // ── Business & data ─────────────────────────────────────────────────────
  { id: 'hubspot', name: 'HubSpot', group: 'Business & data', fields: [{ key: 'token', label: 'Private app access token', secret: true, help: 'HubSpot → Settings → Integrations → Private apps' }], description: 'CRM contacts, companies and deals.',
    test: c => c.call('hubspot_search', { object: 'contacts', query: '', limit: 1 }),
    tools: [
      { name: 'hubspot_search', description: 'Search HubSpot contacts, companies or deals.', schema: z.object({ object: z.enum(['contacts', 'companies', 'deals']), query: z.string().max(200).default(''), limit }),
        run: async ({ object, query, limit }, c) => { const props = { contacts: ['firstname', 'lastname', 'email', 'company'], companies: ['name', 'domain', 'industry'], deals: ['dealname', 'amount', 'dealstage', 'closedate'] }[object]; return ((await request('POST', `https://api.hubapi.com/crm/v3/objects/${object}/search`, { ...c.opts, headers: bearer(c.get('token')), body: { query: query || undefined, limit, properties: props } })).results || []).map(r => ({ id: r.id, ...pick(r.properties, props) })); } },
      { name: 'hubspot_create_contact', write: true, description: 'Create a HubSpot contact.', schema: z.object({ email: z.string().email(), firstname: z.string().max(100).optional(), lastname: z.string().max(100).optional(), company: z.string().max(200).optional() }),
        run: async (properties, c) => pick(await request('POST', 'https://api.hubapi.com/crm/v3/objects/contacts', { ...c.opts, headers: bearer(c.get('token')), body: { properties } }), ['id', 'createdAt']) }
    ] },
  { id: 'salesforce', name: 'Salesforce', group: 'Business & data', fields: [{ key: 'instance', label: 'Instance URL', placeholder: 'yourorg.my.salesforce.com' }, { key: 'token', label: 'Access token', secret: true, help: 'From `sf org display` or a connected app' }], description: 'Read-only SOQL queries.',
    test: c => c.call('salesforce_query', { soql: 'SELECT Id FROM Account LIMIT 1' }),
    tools: [
      { name: 'salesforce_query', description: 'Run a read-only SOQL SELECT query.', schema: z.object({ soql: z.string().trim().max(2000).regex(/^select\s/i, 'Only SELECT queries are allowed') }),
        run: async ({ soql }, c) => { const r = await request('GET', `${httpsOrigin(c.get('instance'))}/services/data/v62.0/query`, { ...c.opts, headers: bearer(c.get('token')), query: { q: soql } }); return { total: r.totalSize, records: (r.records || []).slice(0, 50).map(({ attributes, ...rest }) => rest) }; } }
    ] },
  { id: 'stripe', name: 'Stripe', group: 'Business & data', fields: [{ key: 'apiKey', label: 'Restricted API key (read-only)', secret: true, help: 'dashboard.stripe.com/apikeys → Create restricted key' }], description: 'Balance, customers, charges and invoices. Read-only.',
    test: c => c.call('stripe_balance', {}),
    tools: [
      { name: 'stripe_balance', description: 'Current Stripe balance.', schema: z.object({}),
        run: async (_, c) => { const b = await request('GET', 'https://api.stripe.com/v1/balance', { ...c.opts, headers: bearer(c.get('apiKey')) }); return { available: b.available.map(a => `${(a.amount / 100).toFixed(2)} ${a.currency.toUpperCase()}`), pending: b.pending.map(a => `${(a.amount / 100).toFixed(2)} ${a.currency.toUpperCase()}`) }; } },
      { name: 'stripe_recent_charges', description: 'Most recent Stripe charges.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await request('GET', 'https://api.stripe.com/v1/charges', { ...c.opts, headers: bearer(c.get('apiKey')), query: { limit } })).data.map(ch => ({ amount: `${(ch.amount / 100).toFixed(2)} ${ch.currency.toUpperCase()}`, status: ch.status, customer: ch.billing_details?.email || ch.customer, created: new Date(ch.created * 1000).toISOString(), refunded: ch.refunded })) },
      { name: 'stripe_search_customers', description: 'Search Stripe customers by email or name.', schema: z.object({ query: text(200), limit }),
        run: async ({ query, limit }, c) => (await request('GET', 'https://api.stripe.com/v1/customers/search', { ...c.opts, headers: bearer(c.get('apiKey')), query: { query: query.includes(':') ? query : `email~'${query.replace(/'/g, '')}' OR name~'${query.replace(/'/g, '')}'`, limit } })).data.map(cu => pick(cu, ['id', 'name', 'email', 'created'])) },
      { name: 'stripe_open_invoices', description: 'Open (unpaid) Stripe invoices.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await request('GET', 'https://api.stripe.com/v1/invoices', { ...c.opts, headers: bearer(c.get('apiKey')), query: { status: 'open', limit } })).data.map(i => ({ number: i.number, customer: i.customer_email, due: `${(i.amount_due / 100).toFixed(2)} ${i.currency.toUpperCase()}`, dueDate: i.due_date && new Date(i.due_date * 1000).toISOString().slice(0, 10) })) }
    ] },
  { id: 'airtable', name: 'Airtable', group: 'Business & data', fields: [{ key: 'token', label: 'Personal access token', secret: true, help: 'airtable.com/create/tokens' }], description: 'Bases, tables and records.',
    test: c => c.call('airtable_bases', {}),
    tools: [
      { name: 'airtable_bases', description: 'List Airtable bases you can access.', schema: z.object({}),
        run: async (_, c) => (await request('GET', 'https://api.airtable.com/v0/meta/bases', { ...c.opts, headers: bearer(c.get('token')) })).bases.map(b => pick(b, ['id', 'name'])) },
      { name: 'airtable_records', description: 'List records from a table in a base.', schema: z.object({ baseId: z.string().regex(/^app\w+$/), table: text(100), limit, filter: z.string().max(500).optional().describe('Airtable formula') }),
        run: async ({ baseId, table, limit, filter }, c) => (await request('GET', `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, { ...c.opts, headers: bearer(c.get('token')), query: { maxRecords: limit, filterByFormula: filter } })).records.map(r => ({ id: r.id, ...r.fields })) },
      { name: 'airtable_create_record', write: true, description: 'Create a record in an Airtable table.', schema: z.object({ baseId: z.string().regex(/^app\w+$/), table: text(100), fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }),
        run: async ({ baseId, table, fields }, c) => pick(await request('POST', `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, { ...c.opts, headers: bearer(c.get('token')), body: { fields } }), ['id', 'createdTime']) }
    ] },
  { id: 'shopify', name: 'Shopify', group: 'Business & data', fields: [{ key: 'shop', label: 'Shop domain', placeholder: 'your-store.myshopify.com' }, { key: 'token', label: 'Admin API access token', secret: true, help: 'Shopify admin → Apps → Develop apps' }], description: 'Orders, products and store info.',
    test: c => c.call('shopify_shop', {}),
    gql: (c, query, variables) => request('POST', `${httpsOrigin(c.get('shop'), { suffix: '.myshopify.com' })}/admin/api/2025-07/graphql.json`, { ...c.opts, headers: { 'X-Shopify-Access-Token': c.get('token') }, body: { query, variables } }).then(r => { if (r.errors?.length) throw new ConnectorError(`Shopify: ${r.errors[0].message}`); return r.data; }),
    tools: [
      { name: 'shopify_shop', description: 'Store name, currency and plan.', schema: z.object({}),
        run: async (_, c) => (await c.gql('{ shop { name currencyCode plan { displayName } } }')).shop },
      { name: 'shopify_recent_orders', description: 'Most recent orders with totals and fulfillment status.', schema: z.object({ limit }),
        run: async ({ limit }, c) => (await c.gql('query($n:Int!){ orders(first:$n, reverse:true) { nodes { name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } } } }', { n: limit })).orders.nodes.map(o => ({ order: o.name, created: o.createdAt, paid: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus, total: `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}` })) },
      { name: 'shopify_search_products', description: 'Search products by title.', schema: z.object({ query: text(200), limit }),
        run: async ({ query, limit }, c) => (await c.gql('query($q:String,$n:Int!){ products(first:$n, query:$q) { nodes { title status totalInventory } } }', { q: `title:*${query.replace(/[*:]/g, '')}*`, n: limit })).products.nodes }
    ] }
];

/** Postgres is defined separately because it needs a database driver rather than HTTP. */
export const POSTGRES = { id: 'postgres', name: 'Postgres', group: 'Business & data', description: 'Read-only SQL against a Postgres database.',
  fields: [{ key: 'url', label: 'Connection string', secret: true, placeholder: 'postgres://user:pass@host:5432/db' }] };
