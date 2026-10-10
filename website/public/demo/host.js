// Stands in for the extension host of the compiled query panel, in the website's live demo. The panel is the
// extension's own bundle; this script sends it the messages the real host sent for the demo Project (recorded,
// see scripts/demo) and answers its clicks with more of them. Nothing is asked of BigQuery, dbt or Dataform.
(() => {
  const query = new URLSearchParams(location.search);
  const backend = query.get('backend') === 'dbt' ? 'dbt' : 'dataform';
  const tell = (message) => window.parent !== window && window.parent.postMessage({ source: 'vdt-demo', backend, ...message }, location.origin);
  /** The panel listens for the host's messages on its own window */
  const send = (message) => window.postMessage(message, location.origin);

  window.demoSetTheme = (theme) => {
    document.body.classList.toggle('vscode-dark', theme !== 'light');
    document.body.classList.toggle('vscode-light', theme === 'light');
  };
  window.demoSetTheme(query.get('theme'));

  /** Every time of a recorded message, moved by `delta` ms: the demo's compile and runs happen now */
  const moved = (value, delta) => JSON.parse(JSON.stringify(value), (_key, item) => (typeof item === 'number' && item > 1.5e12 && item < 2.5e12 ? item + delta : item));

  // Clicks the panel answers itself, or that need no answer here
  const SILENT = new Set(['projectInfoHidden', 'dataform.loadWorkflowUrls', 'dataform.loadWorkflowJobStats', 'dataform.computeChangedActions', 'dbt.computeChangedActions', 'dataform.stopSnooze']);

  let state;
  let panelReady = false;
  /** The runs that have ended, the oldest first: what the panel's Executions tab lists */
  let history = [];
  let running = false;
  let runs = 0;
  let apiRun = null;
  let lastRunWas = 'cli';
  const timers = [];
  const later = (ms, action) => timers.push(setTimeout(action, ms));

  function sendInitial() {
    // As if the Project was compiled a few seconds before the page was opened
    const delta = Date.now() - 6000 - state.capturedAt;
    for (const message of moved(state.initial, delta)) {
      send(message);
    }
    announceWhenRendered();
  }

  function announceWhenRendered() {
    const started = Date.now();
    const check = () => {
      const root = document.getElementById('root');
      const run = runButton();
      if (root && run) {
        tell({ type: 'rendered' });
        return;
      }
      if (Date.now() - started < 15000) {
        setTimeout(check, 50);
      }
    };
    check();
  }

  // The button that runs the file: "File" in a Dataform Project's panel, "Run" in a dbt Project's
  const runButton = () => [...document.querySelectorAll('button')].find((button) => (/^Run this file/.test(button.title) || /^Run\b/.test(button.textContent.trim())) && button.offsetParent !== null);

  /** Rings the Run button once. The page calls it when it has put the panel in the screenshot's place */
  window.demoPulse = () => {
    const button = runButton();
    if (button) {
      button.classList.add('demo-pulse');
      button.addEventListener('animationend', () => button.classList.remove('demo-pulse'), { once: true });
    }
  };

  const dataformSlice = (touched, value) => ({ slice: 'dataform', touched, value: { compile: state.compile, ...value } });

  function playCliRun() {
    const run = ++runs;
    const delta = Date.now() - state.run.startedAt;
    // Each run of the demo is another run: its ID is its own, so the Runs tab lists them apart
    const messages = JSON.parse(JSON.stringify(moved(state.run.messages, delta)).replace(/(cli-[a-z0-9]{8})/g, `$1${run}`));
    running = true;
    lastRunWas = 'cli';
    tell({ type: 'terminal', terminal: state.terminal });
    messages.forEach(({ at, message }, index) => later(at, () => {
      const entries = message.value.workflowUrls;
      if (entries) {
        message.value.workflowUrls = [...history, ...entries];
      }
      send(message);
      if (index === messages.length - 1) {
        history = message.value.workflowUrls ?? history;
        running = false;
      }
    }));
  }

  function playDbtRun() {
    const delta = Date.now() - state.run.startedAt;
    running = true;
    tell({ type: 'terminal', terminal: state.terminal });
    for (const { at, message } of moved(state.run.messages, delta)) {
      later(at, () => send(message));
    }
    later(state.terminal.lines[state.terminal.lines.length - 1].at + 400, () => { running = false; });
  }

  function playApiRun() {
    const run = ++runs;
    const delta = Date.now() - state.run.startedAt;
    // Each run of the demo is another workflow invocation, with an ID of its own
    const own = (value) => JSON.parse(JSON.stringify(moved(value, delta)).replace(/(\d{10}-[0-9a-f]{8})(-[0-9a-f-]+)/g, `$1${run}$2`));
    const entries = (entry) => dataformSlice(['workflowUrls', 'pendingRun'], { workflowUrls: [...history, entry], pendingRun: null });
    const end = own(state.api.end);
    running = true;
    lastRunWas = 'api';
    for (const step of own(state.api.start)) {
      later(step.at, () => {
        if (step.entry) {
          apiRun = step.entry;
        }
        send(step.message ?? entries(step.entry));
      });
    }
    later(end.at, () => {
      apiRun = null;
      running = false;
      history = [...history, end.entry];
      send(entries(end.entry));
    });
  }

  /** The panel asks how a run through the API is doing, as it does of the real host until the run is over */
  function answerPoll() {
    if (apiRun) {
      const entry = apiRun;
      // An answer of the real host takes about this long
      later(350, () => apiRun === entry && send(dataformSlice(['workflowUrls'], { workflowUrls: [...history, entry] })));
    }
  }

  function handle(message) {
    switch (message.command) {
      case 'ready':
        panelReady = true;
        if (state) {
          sendInitial();
        }
        return;
      case 'run':
      case 'dataform.runApi':
      case 'repeatLastRun': {
        if (running) {
          tell({ type: 'note', command: 'demo.running' });
          return;
        }
        const api = message.command === 'dataform.runApi' || (message.command === 'repeatLastRun' && lastRunWas === 'api');
        if (backend === 'dbt') {
          playDbtRun();
        } else if (api) {
          playApiRun();
        } else {
          playCliRun();
        }
        return;
      }
      case 'dataform.setRunBackend':
        send(dataformSlice(['runBackend', 'apiRunGitState'], { runBackend: message.backend, apiRunGitState: state.api.gitState }));
        return;
      case 'dataform.refreshWorkflowStatuses':
        answerPoll();
        return;
      case 'preview':
        tell({ type: 'preview' });
        return;
      case 'projectInfoShown':
      case 'refreshProjectInfo':
        send(state.projectInfo);
        return;
      case 'copyToClipboard':
        navigator.clipboard?.writeText(message.text).catch(() => {});
        tell({ type: 'note', command: 'copyToClipboard' });
        return;
      default:
        if (!SILENT.has(message.command)) {
          tell({ type: 'note', command: message.command });
        }
    }
  }

  let saved;
  window.acquireVsCodeApi = () => ({ postMessage: handle, getState: () => saved, setState: (value) => { saved = value; } });

  // Nothing in the demo leaves the page: a link says where it goes in the editor
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (link && !link.getAttribute('href').startsWith('#')) {
      event.preventDefault();
      tell({ type: 'note', command: 'link', url: link.href });
    }
  }, true);
  window.open = () => {
    tell({ type: 'note', command: 'link' });
    return null;
  };

  fetch(`./states/${backend}.json`).then((response) => response.json()).then((loaded) => {
    state = loaded;
    if (panelReady) {
      sendInitial();
    }
  });

  const script = document.createElement('script');
  script.type = 'module';
  script.src = './bundle/preview_compiled.js';
  document.body.appendChild(script);
})();
