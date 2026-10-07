select
  customer_id,
  case when lifetime_value >= 1000 then 'gold' else 'standard' end as segment
from {{ ref('dim_customers') }}
