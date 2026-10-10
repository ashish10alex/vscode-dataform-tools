select
  cast(d.customer_id as string) as customer_id,
  case when d.lifetime_value >= 1000 then 'gold' else 'standard' end as segment,
  cc.country_name
from {{ ref('dim_customers') }} as d
left join {{ ref('int_customer_countries') }} as cc using (customer_id)
