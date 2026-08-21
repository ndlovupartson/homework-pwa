// Minimal hash router. No dependency — this app has exactly enough routing
// need to justify ~40 lines, not a router library.

const routes = []; // { pattern: RegExp, keys: string[], render: fn }

export function registerRoute(path, render) {
  const keys = [];
  const pattern = new RegExp(
    '^' +
      path
        .replace(/:[a-zA-Z]+/g, (match) => {
          keys.push(match.slice(1));
          return '([^/]+)';
        })
        .replace(/\//g, '\\/') +
      '$'
  );
  routes.push({ pattern, keys, render });
}

export function navigate(path) {
  window.location.hash = path;
}

function currentPath() {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function startRouter(fallbackPath = '/') {
  const handle = async () => {
    const path = currentPath();
    for (const route of routes) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        route.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
        await route.render(params);
        return;
      }
    }
    navigate(fallbackPath);
  };
  window.addEventListener('hashchange', handle);
  handle();
}
