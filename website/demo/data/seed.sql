-- Invented football data for the website's live demo. Clubs are real; every player and every transfer is made up.
-- Run with: bq query --use_legacy_sql=false --location=europe-west2 < seed.sql   (in the project the demo is captured from)

CREATE SCHEMA IF NOT EXISTS football_data OPTIONS (location = 'europe-west2');

CREATE OR REPLACE TABLE football_data.CLUBS AS
SELECT * FROM UNNEST([
  STRUCT(985 AS club_id, 'Manchester United' AS name, 'GB1' AS domestic_competition_id, 'Old Trafford' AS stadium_name, 74310 AS stadium_seats),
  (631, 'Chelsea', 'GB1', 'Stamford Bridge', 40343),
  (11, 'Arsenal', 'GB1', 'Emirates Stadium', 60704),
  (31, 'Liverpool', 'GB1', 'Anfield', 61276),
  (281, 'Manchester City', 'GB1', 'Etihad Stadium', 53400),
  (148, 'Tottenham Hotspur', 'GB1', 'Tottenham Hotspur Stadium', 62850),
  (762, 'Newcastle United', 'GB1', "St James' Park", 52305),
  (405, 'Aston Villa', 'GB1', 'Villa Park', 42657),
  (29, 'Everton', 'GB1', 'Goodison Park', 39414),
  (379, 'West Ham United', 'GB1', 'London Stadium', 62500),
  (418, 'Real Madrid', 'ES1', 'Santiago Bernabeu', 81044),
  (131, 'Barcelona', 'ES1', 'Camp Nou', 99354),
  (13, 'Atletico Madrid', 'ES1', 'Metropolitano', 70460),
  (368, 'Sevilla', 'ES1', 'Ramon Sanchez-Pizjuan', 43883),
  (27, 'Bayern Munich', 'L1', 'Allianz Arena', 75024),
  (16, 'Borussia Dortmund', 'L1', 'Signal Iduna Park', 81365),
  (15, 'Bayer Leverkusen', 'L1', 'BayArena', 30210),
  (506, 'Juventus', 'IT1', 'Allianz Stadium', 41507),
  (46, 'Inter', 'IT1', 'San Siro', 75817),
  (5, 'AC Milan', 'IT1', 'San Siro', 75817),
  (12, 'Roma', 'IT1', 'Stadio Olimpico', 70634),
  (6195, 'Napoli', 'IT1', 'Stadio Diego Armando Maradona', 54726),
  (583, 'Paris Saint-Germain', 'FR1', 'Parc des Princes', 47929),
  (1041, 'Lyon', 'FR1', 'Groupama Stadium', 59186),
  (162, 'Monaco', 'FR1', 'Stade Louis II', 18523),
  (610, 'Ajax', 'NL1', 'Johan Cruijff ArenA', 55865),
  (294, 'Benfica', 'PO1', 'Estadio da Luz', 64642),
  (720, 'Porto', 'PO1', 'Estadio do Dragao', 50033),
  (336, 'Sporting CP', 'PO1', 'Estadio Jose Alvalade', 50095)
]);

CREATE OR REPLACE TABLE football_data.PLAYERS AS
WITH names AS (
  SELECT
    ['Luca', 'Mateo', 'Jonas', 'Rafael', 'Niko', 'Emil', 'Tiago', 'Marco', 'Dario', 'Felix', 'Oscar', 'Hugo', 'Ivan', 'Leon', 'Milan', 'Andre', 'Bruno', 'Callum', 'Declan', 'Ethan', 'Finn', 'Gabriel', 'Henrik', 'Ismael', 'Joel', 'Kofi', 'Lars', 'Malik', 'Noel', 'Omar', 'Pablo', 'Quentin', 'Ruben', 'Samir', 'Tobias', 'Viktor', 'Yusuf', 'Zane', 'Adem', 'Cesar'] AS first_names,
    ['Almeida', 'Becker', 'Castellano', 'Dvorak', 'Eriksen', 'Fontaine', 'Garrido', 'Hagen', 'Ivanov', 'Jansen', 'Kowalski', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Pereira', 'Quintero', 'Rossi', 'Santoro', 'Tavares', 'Ulrich', 'Varga', 'Weiss', 'Ximenes', 'Yilmaz', 'Zubiri', 'Ashworth', 'Brennan', 'Carvalho', 'Delgado', 'Esposito', 'Ferreira', 'Guerin', 'Holm', 'Ibarra', 'Jovic', 'Keller', 'Lombardi', 'Mensah', 'Nilsson', 'Ortega', 'Petrov', 'Ramires', 'Silvestre', 'Thorsen', 'Vidal', 'Whitmore', 'Zorzi', 'Baptiste', 'Diallo'] AS last_names,
    ['Goalkeeper', 'Centre-Back', 'Left-Back', 'Right-Back', 'Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Winger', 'Right Winger', 'Centre-Forward'] AS positions,
    ['England', 'Spain', 'Germany', 'Italy', 'France', 'Netherlands', 'Portugal', 'Brazil', 'Argentina', 'Belgium', 'Croatia', 'Denmark', 'Sweden', 'Norway', 'Ghana', 'Nigeria', 'Senegal', 'Uruguay', 'Colombia', 'Serbia'] AS countries
)
SELECT
  player_id,
  CONCAT(first_names[OFFSET(MOD(ABS(FARM_FINGERPRINT(CONCAT('f', player_id))), ARRAY_LENGTH(first_names)))], ' ',
         last_names[OFFSET(MOD(ABS(FARM_FINGERPRINT(CONCAT('l', player_id))), ARRAY_LENGTH(last_names)))]) AS name,
  positions[OFFSET(MOD(ABS(FARM_FINGERPRINT(CONCAT('p', player_id))), ARRAY_LENGTH(positions)))] AS position,
  countries[OFFSET(MOD(ABS(FARM_FINGERPRINT(CONCAT('c', player_id))), ARRAY_LENGTH(countries)))] AS country_of_citizenship,
  DATE_ADD(DATE '1975-01-01', INTERVAL MOD(ABS(FARM_FINGERPRINT(CONCAT('d', player_id))), 11000) DAY) AS date_of_birth
FROM names, UNNEST(GENERATE_ARRAY(100001, 350000)) AS player_id;

CREATE OR REPLACE TABLE football_data.TRANSFERS
PARTITION BY DATE_TRUNC(transfer_date, YEAR)
AS
WITH clubs AS (
  SELECT ARRAY_AGG(STRUCT(club_id, name) ORDER BY club_id) AS list FROM football_data.CLUBS
),
numbered AS (
  SELECT (a - 1) * 1000 + b AS n FROM UNNEST(GENERATE_ARRAY(1, 3000)) AS a, UNNEST(GENERATE_ARRAY(1, 1000)) AS b
),
rolled AS (
  SELECT
    n,
    100001 + MOD(ABS(FARM_FINGERPRINT(CONCAT('player', n))), 250000) AS player_id,
    2005 + MOD(ABS(FARM_FINGERPRINT(CONCAT('season', n))), 20) AS season_start,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('window', n))), 100) AS window_roll,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('day', n))), 62) AS day_roll,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('from', n))), 29) AS from_index,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('to', n))), 28) AS to_step,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('free', n))), 100) AS free_roll,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('fee', n))), 1000000) / 1000000 AS fee_roll,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('value', n))), 1000000) / 1000000 AS value_roll
  FROM numbered
)
SELECT
  r.player_id,
  p.name AS player_name,
  -- Three in four moves happen in the summer window, the rest in January
  IF(window_roll < 75, DATE_ADD(DATE(season_start, 7, 1), INTERVAL day_roll DAY), DATE_ADD(DATE(season_start + 1, 1, 1), INTERVAL MOD(day_roll, 31) DAY)) AS transfer_date,
  CONCAT(FORMAT('%02d', MOD(season_start, 100)), '/', FORMAT('%02d', MOD(season_start + 1, 100))) AS transfer_season,
  clubs.list[OFFSET(from_index)].club_id AS from_club_id,
  clubs.list[OFFSET(from_index)].name AS from_club_name,
  clubs.list[OFFSET(MOD(from_index + 1 + to_step, 29))].club_id AS to_club_id,
  clubs.list[OFFSET(MOD(from_index + 1 + to_step, 29))].name AS to_club_name,
  -- A third are free transfers; fees are skewed so that a few are very large, and grow with the years
  IF(free_roll < 33, 0, ROUND(POW(fee_roll, 5) * (45 + 4 * (season_start - 2005)) * 1e6, -5)) AS transfer_fee,
  ROUND((0.5 + POW(value_roll, 3) * 80) * 1e6, -5) AS market_value_in_eur
FROM rolled AS r
CROSS JOIN clubs
JOIN football_data.PLAYERS AS p USING (player_id);
