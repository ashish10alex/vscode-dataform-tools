const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const site = {
  name: "Dataform and dbt Tools for BigQuery",
  /** For the header, where the whole name does not fit beside the navigation */
  shortName: "Dataform and dbt Tools",
  tagline: "The VS Code extension for Dataform and dbt on BigQuery",
  description:
    "Compiled SQL, dry-run cost, schema, preview and runs for Dataform and dbt™ projects on BigQuery, and for Dataform also inline diagnostics, dependency graphs and schema-aware editing — right inside VS Code, Cursor and Antigravity.",
  url: productionHost ? `https://${productionHost}` : "http://localhost:3000",
  repoUrl: "https://github.com/ashish10alex/vscode-dataform-tools",
  changelogSourceUrl:
    "https://github.com/ashish10alex/vscode-dataform-tools/blob/main/CHANGELOG.md",
  googleRecommendationUrl:
    "https://github.com/dataform-co/dataform/blob/main/vscode/README.md",
  marketplace: {
    vscode:
      "https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode",
    openVsx: "https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode",
    npm: "https://www.npmjs.com/package/@ashishalex/dataform-tools",
    pypi: "https://pypi.org/project/dataform-tools/",
  },
  author: {
    name: "Ashish Alex",
    github: "https://github.com/ashish10alex",
    linkedin: "https://www.linkedin.com/in/ashish-alex10/",
    avatar: "https://github.com/ashish10alex.png",
  },
};
