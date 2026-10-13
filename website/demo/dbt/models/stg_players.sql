{{ config(materialized="view") }}

SELECT
  player_id,
  position,
  country_of_citizenship,
  date_of_birth
FROM {{ source("football_data", "PLAYERS") }}
