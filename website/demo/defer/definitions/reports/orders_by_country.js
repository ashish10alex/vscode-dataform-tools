// One view per country, generated in JavaScript.
constants.COUNTRIES.forEach((country) =>
  publish(`orders_${country}`, {
    type: "view",
    schema: "reporting",
    tags: ["generated"],
    description: `Orders placed by customers in ${country.toUpperCase()}.`,
  }).query(
    (ctx) => `
SELECT o.*
FROM ${ctx.ref("fct_orders")} AS o
JOIN ${ctx.ref("dim_customers")} AS c USING (customer_id)
WHERE c.country_code = "${country}"`
  )
);
