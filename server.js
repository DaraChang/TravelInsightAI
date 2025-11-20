/**
 * server.js
 *
 * Simple Node server that talks to a local Ollama service.
 * Tools used: only Node core modules. No Express and no extra packages.
 * Node version: 18 or newer, because we use the built in fetch.
 *
 * What this file does:
 * 1) Reads a small JSON config file (config.json)
 * 2) Serves a tiny HTML page so students can test in the browser
 * 3) Provides routes to read and update the config at run time
 * 4) Calls the Ollama REST API for a single full answer
 * 5) Calls the Ollama REST API for a streaming answer
 *
 * How to run:
 * - First start Ollama and pull a model:
 * ollama pull llama3
 * ollama serve
 * - Then start this server:
 * node server.js
 * - Finally open this page in the browser:
 * http://127.0.0.1:3000
 */
// Core modules from Node
const http = require('http'); // http creates a basic server
const fs = require('fs'); // fs lets us read and write files
const path = require('path'); // path helps build file paths
const url = require('url'); // url helps parse the request path and query
// Path to our JSON configuration file
const CONFIG_PATH = path.join(__dirname, 'config.json');
/**
 * readConfig
 * Reads config.json from disk and parses it.
 * If the file is missing or broken, we return safe default values.
 * This keeps the server usable even when config is not set yet.
 */
function readConfig() {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Could not read config.json. Using safe defaults.', err);
        return {
            ollama: { // Where the Ollama service is and what model to use
                host: 'http://127.0.0.1:11434', // Default Ollama address and port on the same machine
                model: 'llama3', // You can pull this with: ollama pull llama3
                options: { temperature: 0.3, top_p: 0.9 } // Optional sampling settings
            },
            server: { port: 3000 } // Port where our Node server will listen
        };
    }
}
/**
 * writeConfig
 * Saves a new JSON object to config.json with pretty spacing.
 * We write the full object that the client gives us.
 */
function writeConfig(newConfig) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
}
// Keep a copy of the current config in memory for quick access
let cfg = readConfig();
/**
* askOllama
* Calls the Ollama generate endpoint with stream set to false.
* That means the service prepares the full answer and returns one JSON object.
*
* Input: prompt string from the user
* Output: a string with the model answer
*
* Error model: if the response is not OK, we throw an Error which the caller will
catch.
*/
async function askOllama(prompt) {
    // Build the request body for the Ollama API
    const body = {
        model: cfg.ollama.model, // which model to use
        prompt, // what we want the model to answer
        stream: false, // ask for the full answer in a single JSON object
        options: cfg.ollama.options || {} // optional sampling settings
    };
    // Build the absolute URL to the endpoint, based on the host in config.json
    const endpoint = new URL('/api/generate', cfg.ollama.host).toString();
    // Send the HTTP request
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    // Check for a bad status and include the server message to help the student
    if (!res.ok) {
        const text = await res.text();
        throw new Error('Ollama error ' + res.status + ': ' + text);
    }
    // Parse the single JSON and return only the text part
    const data = await res.json();
    return data.response || '';
}
/**
 * streamOllama
 * Calls the same endpoint but with stream set to true, so the service
 * sends many small JSON lines. Each line may contain a field named response
 * which is a piece of text. We do not buffer the full answer. We pass text to
 * the browser as it arrives.
 *
 * Input: req and res from the server, and the prompt string
 * Output: we write plain text chunks to res and then end the response
 */
async function streamOllama(req, res, prompt) {
    const body = {
        model: cfg.ollama.model,
        prompt,
        stream: true, // request a stream of small JSON objects
        options: cfg.ollama.options || {}
    };
    const endpoint = new URL('/api/generate', cfg.ollama.host).toString();
    const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    // If the request failed or the body is missing we return an error to the browser
    if (!r.ok || !r.body) {
        const text = await r.text().catch(() => '');
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Ollama error: ' + text);
        return;
    }
    // Tell the browser that we will send text in chunks
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache'
    });
    // r.body is a stream. We get a reader to pull chunks one by one
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    // We collect text into a buffer and split on new lines
    // Each full line should be a JSON string like { "response": "piece", "done": false }
    let buf = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Convert bytes to text and add to our buffer
        buf += decoder.decode(value, { stream: true });
        // Process each full line we have received so far
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            // Try to parse the line. If it is valid JSON we send the text field to the browser.
            try {
                const obj = JSON.parse(line);
                if (typeof obj.response === 'string') {
                    res.write(obj.response);
                }
            } catch (_) {
                // Ignore a broken line. The next loop will read more data and the text will line up.
            }
        }
    }
    // After the loop we may still have one more partial line
    if (buf.trim()) {
        try {
            const obj = JSON.parse(buf.trim());
            if (typeof obj.response === 'string') res.write(obj.response);
        } catch (_) {}
    }
    // Close the response so the browser knows the stream ended
    res.end();
}
/**
 * pageHtml
 * Returns the complete HTML page as a template string.
 * We keep all the HTML in one place so it is easy for students to read.
 *
 * This page has three main blocks:
 * 1) Ask the model (normal and streaming)
 * 2) View the current config from the server
 * 3) Change the config and save it back to config.json
 */
function pageHtml() {
    return `
<!doctype html>
<html lang="en">
<head>
<!-- Basic metadata so the page works on desktop and mobile -->
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ollama Starter</title>
<!-- Simple inline CSS for layout and basic styling -->
<style>
body { font-family: system-ui, Arial, sans-serif; margin: 2rem; }
code, pre { font-family: Consolas, 'Courier New', monospace; }
.card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin-bottom:
16px; }
.row { display: flex; gap: 12px; align-items: center; }
label { min-width: 120px; display: inline-block; }
textarea { width: 100%; height: 140px; }
input[type=text] { width: 100%; }
.btn { padding: 8px 16px; border: 1px solid #333; border-radius: 8px; background:
#111; color: #fff; cursor: pointer; }
.btn:disabled { opacity: 0.6; }
#out, #outStream { white-space: pre-wrap; border: 1px solid #eee; padding: 12px;
border-radius: 8px; min-height: 80px; background: #fafafa; }
</style>
</head>
<body>
<!-- Page title -->
<h1>Ollama Starter</h1>
<!-- CARD 1: Ask the model (normal and streaming) -->
<div class="card">
<h2>Ask the model</h2>
<p>Type a question below and choose Ask or Ask with streaming.</p>
<!-- Prompt input -->
<textarea id="prompt" placeholder="Write your question here"></textarea>
<!-- Buttons for non streaming and streaming calls -->
<div style="margin-top: 8px;">
<button id="ask" class="btn">Ask</button>
<button id="askStream" class="btn">Ask with streaming</button>
</div>
<!-- Where the non streaming answer will be shown -->
<h3>Answer</h3>
<div id="out"></div>
<!-- Where the streaming answer will be shown -->
<h3>Streaming answer</h3>
<div id="outStream"></div>
</div>
<!-- CARD 2: Show current config from the server -->
<div class="card">
<h2>Current config</h2>
<p>This shows what is in config.json right now.</p>
<pre id="cfg"></pre>
<button id="refresh" class="btn">Refresh</button>
</div>
<!-- CARD 3: Change config and send it back to the server -->
<div class="card">
<h2>Change config</h2>
<p>Change values and press Save. The server updates config.json on disk.</p>
<div class="row"><label>Host</label><input id="host" type="text" /></div>
<div class="row"><label>Model</label><input id="model" type="text" /></div>
<div class="row"><label>Temperature</label><input id="temperature" type="text"
/></div>
<div class="row"><label>Top P</label><input id="topp" type="text" /></div>
<div style="margin-top: 8px;">
<button id="save" class="btn">Save</button>
</div>
</div>
<script>
// getCfg
// Reads GET /config to show the current settings from the server.
async function getCfg() {
const r = await fetch('/config');
const c = await r.json();
document.getElementById('cfg').textContent = JSON.stringify(c, null, 2);
document.getElementById('host').value = c.ollama.host;
document.getElementById('model').value = c.ollama.model;
document.getElementById('temperature').value = c.ollama.options?.temperature ?? '';
document.getElementById('topp').value = c.ollama.options?.top_p ?? '';
}
document.getElementById('refresh').onclick = getCfg;
// Load config when the page opens
getCfg();
// Save button handler
// Sends the new values to POST /config which writes config.json on disk.
document.getElementById('save').onclick = async () => {
const newCfg = {
ollama: {
host: document.getElementById('host').value,
model: document.getElementById('model').value,
options: {
temperature: Number(document.getElementById('temperature').value),
top_p: Number(document.getElementById('topp').value)
}
},
server: { port: 3000 }
};
const r = await fetch('/config', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(newCfg)
});
if (r.ok) {
alert('Saved config');
await getCfg();
} else {
alert('Save failed');
}
};
// Non streaming button handler
// Calls POST /chat. The server returns a single JSON with the full answer.
document.getElementById('ask').onclick = async () => {
const btn = document.getElementById('ask');
btn.disabled = true;
document.getElementById('out').textContent = 'Thinking...';
try {
const r = await fetch('/chat', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ prompt: document.getElementById('prompt').value })
});
const data = await r.json();
document.getElementById('out').textContent = data.answer || data.error || '';
} catch (e) {
document.getElementById('out').textContent = 'Request failed: ' + e.message;
} finally {
btn.disabled = false;
}
};
// Streaming button handler
// Calls POST /chat-stream. We read text chunks and append them as they arrive.
document.getElementById('askStream').onclick = async () => {
const btn = document.getElementById('askStream');
btn.disabled = true;
const out = document.getElementById('outStream');
out.textContent = '';
try {
const r = await fetch('/chat-stream', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ prompt: document.getElementById('prompt').value })
});
const reader = r.body.getReader();
const decoder = new TextDecoder();
while (true) {
const { value, done } = await reader.read();
if (done) break;
out.textContent += decoder.decode(value);
}
} catch (e) {
out.textContent = 'Stream failed: ' + e.message;
} finally {
btn.disabled = false;
}
};
</script>
</body>
</html>`;
}
/**
 * parseBody
 * Collects the bytes of a request and parses JSON.
 * Returns a Promise that resolves to an object. If parsing fails we reject.
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            if (!data) return resolve({}); // allow empty bodies
            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Body is not valid JSON')); }
        });
        req.on('error', reject);
    });
}
/**
 * The server
 * We route based on method and path.
 * Each branch writes a response and returns.
 */
const server = http.createServer(async(req, res) => {
    const { pathname } = url.parse(req.url, true);
    // GET /
    // Sends the small test page
    if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageHtml());
        return;
    }
    // GET /config
    // Reads config.json fresh from disk and returns it
    if (req.method === 'GET' && pathname === '/config') {
        cfg = readConfig(); // always re read so we show what is really on disk
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
        return;
    }
    // POST /config
    // Receives a JSON body with the new config and writes it to config.json
    if (req.method === 'POST' && pathname === '/config') {
        try {
            const body = await parseBody(req);
            // Very simple shape check to help new students find mistakes
            if (!body.ollama || !body.server) throw new Error('Config is missing fields');
            writeConfig(body);
            cfg = readConfig();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }
    // POST /chat
    // Expects a body like { "prompt": "your text" }
    // Calls askOllama to get a single full answer as JSON
    if (req.method === 'POST' && pathname === '/chat') {
        try {
            const body = await parseBody(req);
            const prompt = (body && body.prompt) ? String(body.prompt) : '';
            if (!prompt) throw new Error('Missing prompt');
            const answer = await askOllama(prompt);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }
    // POST /chat-stream
    // Same input as /chat but sends back a stream of text chunks
    if (req.method === 'POST' && pathname === '/chat-stream') {
        try {
            const body = await parseBody(req);
            const prompt = (body && body.prompt) ? String(body.prompt) : '';
            if (!prompt) throw new Error('Missing prompt');
            await streamOllama(req, res, prompt);
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Stream error: ' + e.message);
        }
        return;
    }
    // If we get here the route is unknown
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});
// Start the server and print a friendly message
const PORT = (cfg.server && cfg.server.port) || 3000;
server.listen(PORT, () => {
    console.log('Server ready on http://127.0.0.1:' + PORT);
    console.log('Open your browser at that address to try the page');
});