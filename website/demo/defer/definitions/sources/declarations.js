// The raw tables the project reads, declared in JavaScript.
["customers", "orders"].forEach((name) =>
  declare({
    schema: constants.RAW_SCHEMA,
    name,
    description: `Raw ${name} loaded by the ingestion job.`,
  })
);
