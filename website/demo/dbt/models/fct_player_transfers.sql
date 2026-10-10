{{ config(materialized="table") }}

WITH transfers AS (
  SELECT * FROM {{ source("football_data", "TRANSFERS") }}
)

, signings AS (
  SELECT *
  FROM transfers
  WHERE to_club_id = {{ var("manchester_united_club_id") }}
)

SELECT *
FROM signings
QUALIFY
  ROW_NUMBER() OVER (
    PARTITION BY transfer_season
    ORDER BY transfer_fee DESC
  ) = 1
ORDER BY transfer_date DESC
