-- No completed order has a negative total.
select order_id, amount
from {{ ref('fct_orders') }}
where status = 'completed' and amount < 0
