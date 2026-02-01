/* DevFlow Content Script */

// --- Content Script Context ---

// Data Map
const dataMap = [];
let detectedFramework = 'Unknown';

// UI Layer: Shadow DOM Overlay
const overlayHost = document.createElement('div');
overlayHost.id = 'devflow-overlay-host';
overlayHost.style.position = 'fixed';
overlayHost.style.top = '0';
overlayHost.style.left = '0';
overlayHost.style.width = '0';
overlayHost.style.height = '0';
overlayHost.style.zIndex = '2147483647';
overlayHost.style.pointerEvents = 'none';
document.documentElement.appendChild(overlayHost);

const shadow = overlayHost.attachShadow({ mode: 'open' });
const tooltip = document.createElement('div');

// Tooltip Styling
tooltip.style.position = 'fixed';
tooltip.style.backgroundColor = 'rgba(20, 20, 20, 0.95)';
tooltip.style.color = '#eee';
tooltip.style.padding = '10px 14px';
tooltip.style.borderRadius = '8px';
tooltip.style.fontSize = '12px';
tooltip.style.fontFamily = 'Consolas, Monaco, "Andale Mono", monospace';
tooltip.style.pointerEvents = 'none';
tooltip.style.display = 'none';
tooltip.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)';
tooltip.style.backdropFilter = 'blur(10px)';
tooltip.style.maxWidth = '350px';
tooltip.style.overflow = 'hidden';
tooltip.style.zIndex = '2147483647';
shadow.appendChild(tooltip);

// State for matching
let lastHoveredElement = null;
let lastMatch = null;

function showTooltip(target, matchData, framework = 'Unknown') {
    const rect = target.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;

    if (top + 100 > window.innerHeight) top = rect.top - 110;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;

    tooltip.style.display = 'block';
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Different UI based on Source Type
    let sourceBadge = '';
    let sourceDetail = '';
    let keyColor = '#f8fafc';
    let valColor = '#86efac';

    if (matchData.type === 'API') {
        sourceBadge = '<span style="color:#64748b;">API Match</span>';
        const urlDisplay = matchData.source.length > 35 ? '...' + matchData.source.slice(-35) : matchData.source;
        sourceDetail = `Source: ${urlDisplay}`;
    } else if (matchData.type.startsWith('React')) {
        sourceBadge = `<span style="color:#a78bfa;">${matchData.type}</span>`;
        sourceDetail = `<span style="color:#d8b4fe;">Component: <${matchData.component} /></span>`;
        keyColor = '#c084fc'; // Purple for React
        valColor = '#e879f9';
    }

    tooltip.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; color: #a5f3fc;">DevFlow</span>
        <span style="background:#333; color:#aaa; font-size:10px; padding:2px 6px; borderRadius:4px;">${framework}</span>
      </div>
      <div style="margin-bottom:4px; font-size:11px;">
        ${sourceBadge}
      </div>
      <div>
        <span style="color:#94a3b8;">Key:</span> <span style="color:${keyColor}; font-weight:600;">${matchData.key}</span>
      </div>
      <div style="margin-top:4px;">
        <span style="color:#94a3b8;">Value:</span> <span style="color:${valColor};">${matchData.value}</span>
      </div>
      <div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px; font-size:10px; color:#64748b;">
        ${sourceDetail}
      </div>
    `;

    target.style.outline = matchData.type.startsWith('React') ? '2px dashed #c084fc' : '2px dashed #a5f3fc';
    target.style.cursor = 'help';
    target.dataset.devFlowActive = 'true';
}

function hideTooltip() {
    tooltip.style.display = 'none';
    if (lastHoveredElement) {
        lastHoveredElement.style.outline = '';
        delete lastHoveredElement.dataset.devFlowActive;
        lastHoveredElement = null;
    }
}


// Listen for messages from Page Script
window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    // 1. Framework Detected
    if (event.data.type === 'DEVFLOW_FRAMEWORK') {
        detectedFramework = event.data.payload;
    }

    // 2. Fetch Data Captured
    if (event.data.type === 'DEVFLOW_FETCH_DATA') {
        dataMap.unshift(event.data.payload);
        if (dataMap.length > 50) dataMap.pop();
        console.log('[DevFlow] Captured Fetch:', event.data.payload.url);
    }

    // 3. React Match Found (from Page Script)
    if (event.data.type === 'DEVFLOW_REACT_MATCH') {
        // We received a match from the page script's React traversal!
        // We need to find the element again? 
        // Logic issue: The page script knows the element, but content script receives a message.
        // We can't pass DOM elements in postMessage. 
        // FIX: The Page Script triggered the match based on hover. 
        // The user is STILL hovering that element right now.

        // We can assume document.querySelector(':hover') or just use the current mouse target if we tracked it?
        // Better: We track 'mouseover' in content script as well.
        if (lastHoveredElement) {
            const match = event.data.payload;
            lastMatch = match;
            showTooltip(lastHoveredElement, match, detectedFramework);
        }
    }
});


// Heuristic Search (for API data)
function recursiveSearch(obj, targetText, path = '') {
    let matches = [];
    if (!obj) return [];
    if (typeof obj !== 'object') {
        const strVal = String(obj);
        if (strVal.length < 2 && strVal !== targetText) return [];
        if (targetText.includes(strVal)) return [{ key: path, value: obj }];
        return [];
    }
    for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        const result = recursiveSearch(value, targetText, currentPath);
        if (result.length > 0) matches = matches.concat(result);
    }
    return matches;
}


// Local Mouse Event Listener (Content Script Side)
// We still kept this for API matching, and to track 'lastHoveredElement' for the React match
document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target === overlayHost) return;

    lastHoveredElement = target; // Track this!

    const textContent = target.innerText?.trim();
    if (!textContent || textContent.length === 0 || textContent.length > 300) {
        hideTooltip();
        return;
    }

    // 1. Try API Match locally first (fastest)
    const cleanText = textContent.replace(/\s+/g, ' ');
    let apiMatch = null;

    for (const req of dataMap) {
        const matches = recursiveSearch(req.data, cleanText);
        if (matches.length > 0) {
            apiMatch = {
                type: 'API',
                source: req.url,
                key: matches[0].key,
                value: matches[0].value
            };
            break;
        }
    }

    if (apiMatch) {
        lastMatch = apiMatch;
        showTooltip(target, apiMatch, detectedFramework);
    } else {
        // If no API Match, we wait.
        // The Page Script is ALSO running a duplicate mouseover.
        // If IT finds a React match, it will send a message.
        // See 'DEVFLOW_REACT_MATCH' handler above.

        // We hide tooltip if no previous match, but don't clear lastHoveredElement yet
        // so the async message can find it.
        if (tooltip.style.display !== 'none' && !target.dataset.devFlowActive) {
            hideTooltip();
        }
    }
});

document.addEventListener('mouseout', (e) => {
    // Only clear if we are leaving the active element
    if (e.target.dataset.devFlowActive) {
        hideTooltip();
    }
});

document.addEventListener('click', (e) => {
    if (lastMatch && e.target === lastHoveredElement) {
        console.log('%c[DevFlow] Element Clicked!', 'color: #a5f3fc; font-weight: bold;');
        console.log('Match Data:', lastMatch);
    }
});
