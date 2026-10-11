// Stands in for the extension host of the dependency inspector, in the website's live demo. The inspector is the
// extension's own bundle; this script answers it with what the real host answered for the demo Project (recorded,
// see scripts/demo): its models, the dependencies of one, and a dry run and a run of each table with one filter.
// Nothing is asked of BigQuery.
(async () => {
  const query = new URLSearchParams(location.search);
  const tell = (message) => window.parent !== window && window.parent.postMessage({ source: 'vdt-demo', backend: 'inspector', ...message }, location.origin);
  const send = (message) => window.postMessage(message, location.origin);

  window.demoSetTheme = (theme) => {
    document.body.classList.toggle('vscode-dark', theme !== 'light');
    document.body.classList.toggle('vscode-light', theme === 'light');
  };
  window.demoSetTheme(query.get('theme'));

  const state = await fetch('./states/inspector.json').then((response) => response.json());
  // As the inspector keeps a model's filters: it opens with the filter the rows were recorded for
  try {
    localStorage.setItem(`dataform-dep-inspector:${state.modelFullId}`, JSON.stringify(state.saved));
  } catch {
    // Storage is off: the visitor types the filter
  }

  const sameFilter = (filter) => (filter ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === state.filter.toLowerCase();
  const onlyThisFilter = `The demo has rows for one filter only: ${state.filter}`;

  function dependenciesTo(depth) {
    const kept = state.dependencies.value.filter((dependency) => dependency.depth <= depth);
    const ids = new Set([state.modelFullId, ...kept.map((dependency) => dependency.fullId)]);
    return { ...state.dependencies, value: kept, edges: state.dependencies.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }

  function handle(message) {
    const value = message.value ?? {};
    switch (message.command) {
      case 'appLoaded':
      case 'getModels':
        send({ ...state.models, initialModelId: state.modelFullId });
        return;
      case 'fetchDependencies':
        if (value.modelFullId !== state.modelFullId) {
          tell({ type: 'note', command: 'inspector.otherModel' });
          send({ type: 'dependencies', value: [], edges: [], selectedModelId: value.modelFullId });
          return;
        }
        setTimeout(() => send(dependenciesTo(Math.max(1, Math.min(value.depth ?? 3, 3)))), 200);
        return;
      case 'dryRun': {
        const table = state.tables[value.tableId];
        if (!table || !sameFilter(value.filter)) {
          tell({ type: 'note', command: 'inspector.otherFilter' });
          send({ type: 'dryRunResult', value: { tableId: value.tableId, query: '', error: onlyThisFilter } });
          return;
        }
        setTimeout(() => send(table.dryRun), table.dryRunMs);
        return;
      }
      case 'runQuery': {
        const table = state.tables[value.tableId];
        send({ type: 'queryLoading', value: { tableId: value.tableId } });
        if (!table || !sameFilter(value.filter)) {
          tell({ type: 'note', command: 'inspector.otherFilter' });
          setTimeout(() => send({ type: 'queryResult', value: { tableId: value.tableId, query: '', error: onlyThisFilter } }), 300);
          return;
        }
        setTimeout(() => send(table.query), table.queryMs);
        return;
      }
      case 'getTableSchema': {
        const table = state.tables[value.fullTableId];
        if (table) {
          setTimeout(() => send(table.schema), 250);
        } else {
          send({ type: 'schemaError', value: { fullTableId: value.fullTableId, error: 'The demo has no schema for this table.' } });
        }
        return;
      }
      case 'getLatestFilterPreset':
        return;
      default:
        tell({ type: 'note', command: `inspector.${message.command}` });
    }
  }

  window.acquireVsCodeApi = () => ({ postMessage: handle, getState: () => undefined, setState: () => {} });

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (link && !link.getAttribute('href').startsWith('#')) {
      event.preventDefault();
      tell({ type: 'note', command: 'link' });
    }
  }, true);
  window.open = () => {
    tell({ type: 'note', command: 'link' });
    return null;
  };

  const button = (words) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === words && candidate.offsetParent !== null);

  /** How tall the frame must be to show the inspector down to the end of its graph. The page itself is as tall as its window at least, so its own height tells nothing */
  const neededHeight = () => Math.ceil(document.querySelector('.react-flow').parentElement.getBoundingClientRect().bottom + window.scrollY) + 20;

  // The demo opens on the graph of the model and what it reads from, which is the inspector's Graph tab
  const started = Date.now();
  (function openGraph() {
    const graph = button('Graph');
    if (graph && button('Run All')) {
      graph.click();
      setTimeout(() => {
        tell({ type: 'rendered', height: neededHeight() });
      }, 400);
      return;
    }
    if (Date.now() - started < 15000) {
      setTimeout(openGraph, 50);
    }
  })();

  /** Rings Run All once. The page calls it when the inspector has come into view */
  window.demoPulse = () => {
    const run = button('Run All');
    if (run) {
      run.classList.add('demo-pulse');
      run.addEventListener('animationend', () => run.classList.remove('demo-pulse'), { once: true });
    }
  };

  const script = document.createElement('script');
  script.type = 'module';
  script.src = './bundle/dependency-inspector.js';
  document.body.appendChild(script);
})();
