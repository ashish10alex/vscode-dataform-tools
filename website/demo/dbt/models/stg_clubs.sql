{{ config(materialized="view") }}

SELECT
  club_id,
  name AS club_name,
  domestic_competition_id AS competition,
  stadium_name,
  stadium_seats
FROM {{ source("football_data", "CLUBS") }}
