// Stands in for the extension host of the query results view, in the website's live demo: it answers the view
// with rows made up beforehand. Nothing is asked of BigQuery.
(() => {
  const query = new URLSearchParams(location.search);
  const backend = query.get('backend') === 'dbt' ? 'dbt' : 'dataform';
  const tell = (message) => window.parent !== window && window.parent.postMessage({ source: 'vdt-demo', ...message }, location.origin);

  window.demoSetTheme = (theme) => {
    document.body.classList.toggle('vscode-dark', theme !== 'light');
    document.body.classList.toggle('vscode-light', theme === 'light');
  };
  window.demoSetTheme(query.get('theme'));

  const preview = fetch(`./states/${backend}.json`).then((response) => response.json()).then((state) => state.preview);
  const send = (message) => window.postMessage(message, location.origin);

  window.acquireVsCodeApi = () => ({
    getState: () => undefined,
    setState: () => {},
    postMessage: (message) => {
      if (message.command === 'appLoaded') {
        send({ showLoadingMessage: true, incrementalCheckBox: false, queryLimit: 1000 });
        preview.then(({ loadingMs, payload }) => setTimeout(() => {
          send({ ...payload, jobStats: { ...payload.jobStats, bigQueryJobEndTime: new Date() } });
          tell({ type: 'results shown' });
        }, loadingMs));
        return;
      }
      tell({ type: 'note', command: `results.${message.command}` });
    },
  });

  const script = document.createElement('script');
  script.type = 'module';
  script.src = './bundle/query_results.js';
  document.body.appendChild(script);
})();
