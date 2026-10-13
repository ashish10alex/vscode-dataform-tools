select
  id as order_id,
  user_id as customer_id,
  order_date,
  status
from {{ source('raw', 'orders') }}
where order_date >= '{{ var("start_date") }}'
