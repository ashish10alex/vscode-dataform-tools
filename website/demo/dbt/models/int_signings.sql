{{ config(materialized="view") }}

SELECT
  transfers.*,
  players.position,
  players.country_of_citizenship,
  clubs.competition AS to_club_competition
FROM {{ ref("stg_transfers") }} AS transfers
JOIN {{ ref("stg_players") }} AS players USING (player_id)
LEFT JOIN {{ ref("stg_clubs") }} AS clubs ON transfers.to_club_id = clubs.club_id
