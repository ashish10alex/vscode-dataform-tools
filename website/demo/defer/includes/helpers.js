// SQL helpers, available as `helpers` in .sqlx files.
function centsToDollars(column) {
  return `ROUND(${column} / 100, 2)`;
}

module.exports = { centsToDollars };
