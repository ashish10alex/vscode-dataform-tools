-- Ephemeral: inlined as a CTE wherever it is used.
select
  c.customer_id,
  coalesce(cc.country_name, 'Unknown') as country_name
from {{ ref('stg_customers') }} as c
left join {{ ref('country_codes') }} as cc
  on c.country_code = cc.country_code
