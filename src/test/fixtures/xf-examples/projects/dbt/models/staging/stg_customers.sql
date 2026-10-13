select
  id as customer_id,
  lower(email) as email,
  country_code,
  created_at
from {{ source('raw', 'customers') }}
