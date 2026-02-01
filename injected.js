
(function () {
    // --- Page Context Code ---
    const DEVFLOW_ID = 'DevFlow-Extension';

    // 1. Framework Detection
    function detectFramework() {
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return 'React';
        if (window.Vue || document.querySelector('[vue-app]')) return 'Vue';
        if (document.querySelector('app-root')) return 'Angular';
        return 'Plain JS';
    }

    const framework = detectFramework();
    window.postMessage({ type: 'DEVFLOW_FRAMEWORK', payload: framework }, '*');

    // 2. React Fiber Traversal Logic
    const ReactScanner = {
        getFiber(dom) {
            for (const key in dom) {
                if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
                    return dom[key];
                }
            }
            return null;
        },

        getComponentName(fiber) {
            // Try specific tag names first
            if (fiber.type && typeof fiber.type === 'function') return fiber.type.name || 'Component';
            if (fiber.type && typeof fiber.type === 'string') return fiber.type; // e.g. "div"
            if (fiber.elementType && fiber.elementType.name) return fiber.elementType.name;
            return 'Unknown';
        },

        // Recursive search in an object (props or state)
        searchObject(obj, targetText, path = '', visited = new Set()) {
            if (!obj || typeof obj !== 'object') {
                // Base case: Compare value
                const strVal = String(obj);
                if (strVal.length < 1) return null;

                // Flexible matching: check if target contains value (e.g. "$500" contains "500")
                // Only if value is significant (length > 1 or specific numbers)
                if (targetText.includes(strVal) && strVal !== targetText) {
                    return { key: path, value: obj, exact: false };
                }
                if (strVal === targetText) {
                    return { key: path, value: obj, exact: true };
                }
                return null;
            }

            if (visited.has(obj)) return null;
            visited.add(obj);

            for (const [key, value] of Object.entries(obj)) {
                // Skip internal React keys and large objects
                if (key.startsWith('_') || key === 'children' || typeof value === 'function') continue;

                const currentPath = path ? `${path}.${key}` : key;
                const match = this.searchObject(value, targetText, currentPath, visited);
                if (match) return match;
            }
            return null;
        },

        findMatch(target) {
            let fiber = this.getFiber(target);
            if (!fiber) return null;

            const textContent = target.innerText?.trim();
            if (!textContent) return null;

            // Walk up the tree
            let currentForTraversal = fiber;
            let depth = 0;
            const maxDepth = 10; // Don't go too high

            while (currentForTraversal && depth < maxDepth) {
                const name = this.getComponentName(currentForTraversal);

                // Skip standard HTML tags (HostComponents) unless they have interesting props (rare)
                const isHostComponent = typeof currentForTraversal.type === 'string';

                if (!isHostComponent) {
                    // Check Props
                    if (currentForTraversal.memoizedProps) {
                        const propMatch = this.searchObject(currentForTraversal.memoizedProps, textContent);
                        if (propMatch) {
                            return {
                                type: 'ReactProp',
                                component: name,
                                key: propMatch.key,
                                value: propMatch.value
                            };
                        }
                    }

                    // Check State (Class components or Hooks)
                    if (currentForTraversal.memoizedState) {
                        const stateMatch = this.searchObject(currentForTraversal.memoizedState, textContent);
                        if (stateMatch) {
                            return {
                                type: 'ReactState',
                                component: name,
                                key: stateMatch.key,
                                value: stateMatch.value
                            };
                        }
                    }
                }

                currentForTraversal = currentForTraversal.return;
                depth++;
            }
            return null;
        }
    };

    // 3. Global Mouseover Listener for React Inspection
    document.addEventListener('mouseover', (e) => {
        // Debounce or lightweight check?
        // We only check if it looks like a meaningful element
        if (e.target.innerText && e.target.innerText.length > 0 && e.target.innerText.length < 100) {
            const match = ReactScanner.findMatch(e.target);
            if (match) {
                window.postMessage({
                    type: 'DEVFLOW_REACT_MATCH',
                    payload: match
                }, '*');
            }
        }
    });


    // 4. Proxy Logic (Fetch Interceptor) - Safe & Silent
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        // We just pass through the request without modifying it first
        // to ensure we don't break the site's own logic or CSP.
        const fetchPromise = originalFetch(...args);

        // We attach our "spy" logic in a non-blocking way
        fetchPromise.then(async (response) => {
            // If the request failed (e.g. CSP block), response might be undefined or 'ok' is false
            // We only care about successful JSON responses
            if (!response || !response.ok) return;

            // Check content type before cloning to avoid overhead on images/large files
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) return;

            try {
                const clone = response.clone();
                const data = await clone.json();
                window.postMessage({
                    type: 'DEVFLOW_FETCH_DATA',
                    payload: { url: args[0], data: data, timestamp: Date.now() }
                }, '*');
            } catch (e) {
                // Silently ignore cloning/parsing errors
            }
        }).catch(err => {
            // Ensure we don't log errors for requests that were going to fail anyway
            // The original fetchPromise will still reject for the app to handle, 
            // but we don't want to add extra noise.
        });

        return fetchPromise;
    };

    console.log('[DevFlow-Page] Interceptor Ready.');
})();
