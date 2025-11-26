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
<h1>TravelInsightAI</h1>
<!-- CARD 1: Input Area -->
<div class="card">
<h2>Let's plan your trip</h2>
<p>Please provide this information, AI will offer customized trip advice to you</p>

<!-- destination -->
<div class="row" style="margin-bottom: 12px;">
    <label>Trip Destination</label>
    <input id="destination" type="text" placeholder="例如：日本東京、法國巴黎" />
</div>

<!-- start time -->
<div class="row" style="margin-bottom: 12px;">
    <label>Start Time</label>
    <input id="startDate" type="date" />
</div>

<!-- end time -->
<div class="row" style="margin-bottom: 12px;">
    <label>End Time</label>
    <input id="endDate" type="date" />
</div>

<!-- Submit -->
<div style="margin-top: 8px;">
    <button id="planTrip" class="btn">Plan the trip</button>
</div>

<!-- Result -->
<h3>Result</h3>
<div id="out"></div>
</div>
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
// Calls POST /user/preferences. The server returns a single JSON with the full answer.
document.getElementById('ask').onclick = async () => {
const btn = document.getElementById('ask');
btn.disabled = true;
document.getElementById('out').textContent = 'Thinking...';
try {
const r = await fetch('/user/preferences', {
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

// 旅遊規劃按鈕處理
document.getElementById('planTrip').onclick = async () => {
    const btn = document.getElementById('planTrip');
    btn.disabled = true;
    document.getElementById('out').textContent = '正在規劃您的旅程...';
    
    try {
        const destination = document.getElementById('destination').value;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        // 驗證輸入
        if (!destination || !startDate || !endDate) {
            alert('請填寫所有欄位');
            btn.disabled = false;
            return;
        }
        
        const r = await fetch('/user/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                destination: destination,
                startDate: startDate,
                endDate: endDate
            })
        });
        
        const data = await r.json();
        
        if (data.error) {
            document.getElementById('out').textContent = '錯誤：' + data.error;
        } else {
            // 格式化顯示結果
            document.getElementById('out').textContent = '';
        }
    } catch (e) {
        document.getElementById('out').textContent = '請求失敗：' + e.message;
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

    // POST /chat
    if (req.method === 'POST' && pathname === '/user/preferences') {
        try {
            const body = await parseBody(req);

            // extract trip info
            const destination = (body && body.destination) ? String(body.destination) : '';
            const startDate = (body && body.startDate) ? String(body.startDate) : '';
            const endDate = (body && body.endDate) ? String(body.endDate) : '';

            // validate input
            if (!destination) throw new Error('Missing destination');
            if (!startDate) throw new Error('Missing start date');
            if (!endDate) throw new Error('Missing end date');

            // 構建給 Ollama 的 prompt
            const prompt = `I'm planning a trip to ${destination}，from${startDate}to${endDate}。

            please provide below information in json format：

            1. recommended spot：list ${destination} must-visit attraction

            2. suggested prepared equipment：provide suggestion on things to bring based on trip destination and time

            3. trip precautions:provide anything that the traveler should be aware of based on the destination and time

           `;

            // 發送給 Ollama
            const answer = await askOllama(prompt);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                destination,
                startDate,
                endDate,
                answer
            }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }
    // // POST /chat-stream
    // // Same input as /chat but sends back a stream of text chunks
    // if (req.method === 'POST' && pathname === '/chat-stream') {
    //     try {
    //         const body = await parseBody(req);
    //         const prompt = (body && body.prompt) ? String(body.prompt) : '';
    //         if (!prompt) throw new Error('Missing prompt');
    //         await streamOllama(req, res, prompt);
    //     } catch (e) {
    //         res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    //         res.end('Stream error: ' + e.message);
    //     }
    //     return;
    // }
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