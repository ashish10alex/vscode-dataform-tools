{{ config(materialized="view") }}

SELECT
  player_id,
  player_name,
  transfer_date,
  transfer_season,
  from_club_id,
  from_club_name,
  to_club_id,
  to_club_name,
  transfer_fee,
  market_value_in_eur
FROM {{ source("football_data", "TRANSFERS") }}
WHERE transfer_date IS NOT NULL
