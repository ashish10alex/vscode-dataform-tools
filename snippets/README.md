# BigQuery snippets & Hover docs

## Functions with their arguments

`bigquery-functions.json` is the catalog of the BigQuery functions the editor explains: each function's arguments with their types, which are optional and which values they take, what it returns, an example and the link to its docs. The snippets, the hover and the signature help (the hints shown as you type the arguments) are all made from it.

After editing it, run `just bigquery-snippets` to write `bigquery-functions.code-snippets.json`, the snippet file that `package.json` registers for `.sqlx` files. Commit both: a test fails while the snippet file is out of date.

- `values` is the fixed set an argument takes (the snippet offers it as a dropdown), or the name of one of the `valueSets`.
- `before` is the keyword in front of an argument that does not follow a comma, such as `AS` in `CAST(x AS INT64)`.
- `snippet` is what the snippet inserts for an argument when it is not just its name: `{text}` is a tab stop holding `text`, and `{A|B}` a dropdown.
- `window` is `required` for a window function that always takes `OVER (...)`, and `optional` for an aggregate that may.

## Other snippets

The other BigQuery snippets in `bigquery.code-snippets.json` are borrowed from the [vscode-language-sql-bigquery](https://github.com/shinichi-takii/vscode-language-sql-bigquery) VS Code extension. Full credit goes to the author @shinichi-takii.
Its functions that are not in the catalog yet keep their snippet, and their description shows on hover. Moving a function into the catalog means removing it from this file.
