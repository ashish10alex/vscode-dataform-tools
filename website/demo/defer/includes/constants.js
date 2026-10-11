// Values shared by every file. Includes are available as `constants`.
const RAW_SCHEMA = "raw";
const COUNTRIES = ["gb", "us"];
const START_DATE = dataform.projectConfig.vars.start_date;

module.exports = { RAW_SCHEMA, COUNTRIES, START_DATE };
